import { Agent, Box } from "@upstash/box";

// Aider custom agent harness (github.com/Aider-AI/aider)
//
// Requires: ANTHROPIC_API_KEY (Anthropic) or OPENAI_API_KEY (OpenAI)
//
// Aider is a Python-based coding agent. The harness uses uv to install
// aider-chat with Python 3.12 and runs it with --message for headless execution.

const agentSource = `
import sys, os, json, subprocess, uuid, re, glob

args = sys.argv[1:]

def read_arg(name, fallback=""):
    try:
        idx = args.index(name)
        return args[idx + 1] if idx + 1 < len(args) else fallback
    except ValueError:
        return fallback

def emit(event, data):
    sys.stdout.write("event: " + event + "\\n")
    sys.stdout.write("data: " + json.dumps(data) + "\\n\\n")
    sys.stdout.flush()

def strip_ansi(text):
    return re.sub(r"\\x1b\\[[0-9;]*m", "", text)

ATTACHMENTS_DIR = "/workspace/home/.box-attachments"
read_files = []  # non-text attachments, passed to aider with --read

def is_text_mime(mime):
    if mime.startswith("text/"): return True
    return mime.split(";")[0] in ["application/json","application/javascript",
        "application/typescript","application/xml","application/yaml","application/toml","application/sql"]

def build_prompt(base):
    path = os.environ.get("PROMPT_FILES_PATH")
    if not path: return base
    try:
        import base64
        with open(path) as f: files = json.load(f)
        try: os.unlink(path)
        except: pass
        parts = [base]
        for fi in files:
            if is_text_mime(fi.get("media_type","")):
                content = base64.b64decode(fi["data"]).decode("utf-8")
                parts.append("\\n\\nAttached file: " + (fi.get("filename") or "unnamed") + "\\n" + content)
            else:
                name = os.path.basename(fi.get("filename") or "file")
                file_dir = os.path.join(ATTACHMENTS_DIR, str(uuid.uuid4()))
                os.makedirs(file_dir, exist_ok=True)
                file_path = os.path.join(file_dir, name)
                with open(file_path, "wb") as out: out.write(base64.b64decode(fi["data"]))
                read_files.append(file_path)
                parts.append("\\n\\nAttached file: " + file_path)
        return "".join(parts)
    except: return base

# Aider prints a one-line usage summary after each response, e.g.
#   "Tokens: 12,345 sent, 678 received. Cost: $0.02 message, $0.05 session."
#   "Tokens: 1.2k sent, 304 received. Cost: $0.02 message, $0.05 session."
# We surface the per-message numbers as input/output tokens.
TOKEN_RE = re.compile(r"([\\d.,]+)\\s*([kKmM]?)\\s+(sent|received|cache write|cache hit)")

# Startup and bookkeeping lines aider prints around the answer; sent to stderr
NOISE_RE = re.compile(
    r"^(Warning: Input is not a terminal|Aider respects your privacy|personal info\\.|"
    r"For more info: https://aider\\.chat|Aider v\\d|Model:|Main model:|Weak model:|Editor model:|"
    r"Git repo:|Repo-map:|https://aider\\.chat/HISTORY|Added .* to the chat|"
    r"Restored previous conversation history|Analytics have been permanently disabled|Tokens:|Cost:)"
)
COST_RE = re.compile(r"Cost:\\s+\\$([\\d.]+)\\s+message")

def parse_count(num, suffix):
    n = float(num.replace(",", ""))
    s = suffix.lower()
    if s == "k": n *= 1_000
    elif s == "m": n *= 1_000_000
    return int(n)

if os.environ.get("JSON_SCHEMA"):
    print("[aider] Warning: JSON_SCHEMA is not supported by the Aider harness", file=sys.stderr)

try:
    import json as _json
    with open("/workspace/home/.box-internal/mcp-config.json") as _f:
        _mcp = _json.load(_f)
    if _mcp:
        print("[aider] Warning: MCP servers are not supported by the Aider harness", file=sys.stderr)
except:
    pass

WORK_DIR = "/workspace/home"
os.chdir(WORK_DIR)

prompt = read_arg("-p")
model  = read_arg("--model", "claude-sonnet-4-5-20250929")
session_id = read_arg("--session") or str(uuid.uuid4())

if not prompt:
    emit("error", {"error": "no prompt provided", "session_id": session_id})
    sys.exit(1)

has_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")
if not has_key:
    emit("error", {"error": "ANTHROPIC_API_KEY or OPENAI_API_KEY is required", "session_id": session_id})
    sys.exit(1)

# Aider has no native session concept — chat history is workspace-global by
# default. Route each session_id to its own history files so concurrent
# sessions don't share context.
SESSIONS_DIR = "/workspace/home/.aider-sessions"
session_dir  = os.path.join(SESSIONS_DIR, session_id)
os.makedirs(session_dir, exist_ok=True)
chat_history_file  = os.path.join(session_dir, "chat.history.md")
input_history_file = os.path.join(session_dir, "input.history")
llm_history_file   = os.path.join(session_dir, "llm.history")
is_resume = os.path.exists(chat_history_file)

# Claude models newer than this aider release reject the temperature it sends to
# models it doesn't know. A settings entry replaces aider's built-in one, so only
# add it for models missing from aider's bundled model-settings.yml.
def aider_knows(name):
    pattern = os.path.expanduser("~/.local/share/uv/tools/aider-chat/lib/python*/site-packages/aider/resources/model-settings.yml")
    for path in glob.glob(pattern):
        with open(path) as f:
            if ("- name: " + name + "\\n") in f.read(): return True
    return False

settings_args = []
if "claude" in model and not aider_knows(model):
    model_settings_file = os.path.join(session_dir, "model-settings.yml")
    with open(model_settings_file, "w") as f:
        f.write("- name: " + json.dumps(model) + "\\n  use_temperature: false\\n")
    settings_args = ["--model-settings-file", model_settings_file]

full_prompt = build_prompt(prompt)

extra_args = []
context_files = []
agent_opts = os.environ.get("AGENT_OPTIONS")
if agent_opts:
    try:
        parsed_opts = json.loads(agent_opts)
        # SDK wraps user's agentOptions under an "agentOptions" key
        if "agentOptions" in parsed_opts:
            parsed_opts = parsed_opts["agentOptions"]
        # "files" key adds context files to the aider chat (so it can edit them)
        context_files = parsed_opts.pop("files", [])
        for k, v in parsed_opts.items():
            extra_args += ["--" + k, str(v)]
        if parsed_opts:
            print("[aider] Agent options applied: " + ", ".join(parsed_opts.keys()), file=sys.stderr)
    except Exception as e:
        print("[aider] Warning: Failed to parse AGENT_OPTIONS: " + str(e), file=sys.stderr)

output = ""
input_tokens = 0
output_tokens = 0
total_cost_usd = 0.0

aider_cmd = [
    "aider",
    "--message", full_prompt,
    "--model", model,
    "--no-git",
    "--yes-always",
    "--no-auto-commits",
    "--no-pretty",
    "--no-check-update",
    "--no-show-release-notes",
    "--no-analytics",
    "--chat-history-file", chat_history_file,
    "--input-history-file", input_history_file,
    "--llm-history-file", llm_history_file,
]
if is_resume:
    aider_cmd.append("--restore-chat-history")

for path in read_files:
    aider_cmd += ["--read", path]

proc = subprocess.Popen(
    aider_cmd + settings_args + extra_args + context_files,
    cwd=WORK_DIR,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,  # merge stderr so all output reaches us
    text=True,
    env={**os.environ, "COLUMNS": "10000"},  # stop aider wrapping long lines
)

cached_input_tokens = 0
llm_error = ""  # aider prints model errors (bad key, unknown model) and still exits 0
for line in proc.stdout:
    clean = strip_ansi(line)
    if clean.startswith("litellm.") and "Error" in clean.split(":")[0]:
        llm_error = clean.strip()
    if clean.startswith("Tokens:"):
        # e.g. "Tokens: 4.4k sent, 2.3k cache write, 1.8k cache hit, 215 received. Cost: $0.02 message, ..."
        counts = {kind: parse_count(num, suffix) for num, suffix, kind in TOKEN_RE.findall(clean)}
        input_tokens += counts.get("sent", 0) - counts.get("cache hit", 0)
        cached_input_tokens += counts.get("cache hit", 0)
        output_tokens += counts.get("received", 0)
    # Cost follows the token counts, on the same line or (with cache reads and writes) the next
    cm = COST_RE.search(clean)
    if cm:
        try: total_cost_usd += float(cm.group(1))
        except: pass
    if NOISE_RE.match(clean.strip()):
        sys.stderr.write(clean)
        continue
    output += clean
    emit("text", {"text": clean})

proc.wait()

if proc.returncode == 0 and llm_error and input_tokens + output_tokens == 0:
    emit("error", {"error": llm_error, "input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0, "total_cost_usd": 0, "session_id": session_id})
    sys.exit(1)

if proc.returncode != 0:
    emit("error", {"error": "aider exited with code " + str(proc.returncode) + ": " + output, "input_tokens": input_tokens, "output_tokens": output_tokens, "cached_input_tokens": cached_input_tokens, "total_cost_usd": total_cost_usd, "session_id": session_id})
    sys.exit(1)

emit("done", {"output": output.strip(), "input_tokens": input_tokens, "output_tokens": output_tokens, "cached_input_tokens": cached_input_tokens, "total_cost_usd": total_cost_usd, "session_id": session_id})
`;

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY!,
  baseUrl: process.env.UPSTASH_BOX_BASE_URL,
  runtime: "python",
  agent: {
    harness: Agent.Custom,
    model: "claude-sonnet-4-5-20250929",
    customHarness: {
      command: "python3",
      args: ["/workspace/home/custom-aider-agent.py"],
      protocol: "box-sse-v1",
    },
  },
  env: {
    // Pass whichever key you have — Aider auto-selects the provider from the key
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    PATH: "/home/boxuser/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  },
});

console.log(`Created box: ${box.id}`);

try {
  console.log("Installing aider-chat...");
  await box.exec.command(`
    curl -LsSf https://astral.sh/uv/install.sh | sh 2>&1 | tail -2
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    uv python install 3.12 2>&1 | tail -1
    uv tool install aider-chat --python 3.12 2>&1 | tail -2
  `);

  await box.files.write({
    path: "custom-aider-agent.py",
    content: agentSource,
  });

  console.log("\n=== Turn 1 ===");
  const run1 = await box.agent.run({
    prompt: "Create a file called hello.py that prints 'Hello from Aider!'",
  });
  console.log(run1.result);

  console.log("\n=== Turn 2 (follow-up) ===");
  const run2 = await box.agent.run({
    prompt: "Now add a second print statement to hello.py that prints 'Session memory works!'",
    options: {
      // Pass context files so Aider can edit them
      agentOptions: { files: ["hello.py"] },
    },
  });
  console.log(run2.result);
} finally {
  await box.delete();
  console.log("\nBox deleted.");
}

const BASH_COMPLETION = `
_box_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="create connect from-snapshot list get init-demo completion"
  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}
complete -F _box_completions box
`;

const ZSH_COMPLETION = `
#compdef box

_box() {
  local -a commands
  commands=(
    'create:Create a new box and enter the REPL'
    'connect:Connect to an existing box and enter the REPL'
    'from-snapshot:Create a new box from a snapshot'
    'list:List all boxes'
    'get:Get details about a box'
    'init-demo:Scaffold a standalone demo project'
    'completion:Output shell completion script'
  )
  _describe 'command' commands
}

_box
`;

export function completionCommand(): void {
  const shell = process.env.SHELL ?? "";
  if (shell.includes("zsh")) {
    console.log(ZSH_COMPLETION.trim());
  } else {
    console.log(BASH_COMPLETION.trim());
  }
}

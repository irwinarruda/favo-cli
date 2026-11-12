export const HelpText = `favo, a honeycomb for your AI subscriptions

  favo                               open the comb
  favo claude [account] [args]       run a provider as an account
                                     (claude, codex, agy, opencode)
                                     the args after it go to the provider
  favo --dir <folder> claude [account]
                                     start it in that folder

Accounts
  favo list [--json]                 every machine, account and login
  favo usage [--json]                what every seat has left, and when it
                                     comes back (Claude Code, Codex)
  favo usage --tokens                what every seat used, counted from the
                                     session logs on each machine
  favo usage --cost                  the same in dollars, at API list prices
                                     (base rates, not your subscription bill)
      --days <n> | --all             the period: 30 days, or all favo has kept
      --machine, --account, --provider <name>
                                     only those, each as often as you like
                                     --limits is the default page
  favo add <account>                 add a cell
  favo rename <account> <new name>   rename a cell, its folder stays put
  favo rm <account>                  move a cell to the trash
  favo login <provider> <account>    sign in, with the official command
  favo logout <provider> <account>   sign out
  favo path <provider> <account>     print the config path, for T3 Code
  favo app <provider> <account>      open the Claude, ChatGPT or Antigravity app
                                     as an account, on this computer (claude,
                                     codex, and antigravity on macOS or Windows)
                                     --close closes it first if it is open
  favo sync [account]                repair shared links
  favo inspect <provider> <account>  show what is shared and what is private
  favo adopt <provider> <account> <folder>
                                     move an existing config folder in

Threads
  favo resume <provider> <account> [thread] [args]
                                     go back to a thread, in its own folder
                                     the newest one here, unless you pick one
  favo threads <provider> <account>  the threads favo kept for a seat
  favo hooks status                  whether each provider tells favo its thread
  favo hooks install                 add favo's hook to your provider config
  favo hooks uninstall               take it out again

Machines
  favo machine list                  machines this one can reach
  favo machine discover              find machines on ssh and Tailscale
  favo machine add <user@host>       add a machine and install favo there
  favo machine install <machine>     update favo on a machine
  favo machine update                update every machine on an older favo
  favo machine rm <machine>          forget a machine

Updates
  favo update                        update favo here and on every machine
  favo update --providers            the same, then the provider CLIs on each
  favo update --machine <machine>    only there (local means this computer)

Themes
  favo theme                         list themes
  favo theme <theme>                 use a theme, saved in ~/.favo/config.json
                                     custom themes live in ~/.favo/themes

Most commands take --machine <machine> to run on another computer. When favo
starts a provider, its own options go before the provider.
`;

# bld.t for VS Code

Your bld.t tasks, team, and discussions, where you write code.

## What it does

- **My tasks.** Everything assigned to you across projects, updating live. Start a task and the extension assigns it to you, moves it to In progress, and creates a branch named after it (`username/key-7-task-title`), so the pull request links itself to the task.
- **Current task in the status bar.** Detected from your branch. Click to move it to review or done.
- **Team.** Who is working right now, on which task, branch, and (if they share it) file.
- **Same-file warnings.** When a teammate is editing the file you are in, both of you are told, before it becomes a merge conflict.
- **Huddle and pair.** One click invites a teammate to a call, or to a Live Share session to code together.
- **Ask the team.** On any error, use the light bulb or right-click: if your team solved the same error before, you get the answer immediately; otherwise it posts a help thread with the error, file, line, code, branch, and commit, and notifies your team.
- **Notifications.** Huddle invites, replies, help requests, and alerts appear as VS Code notifications.

## Sign in

Run **bld.t: Sign in**. The first time, it asks for your bld.t address: the one you open bld.t at in your browser. It must use `https://` (plain `http://` is accepted only for `localhost` and `127.0.0.1`, for development). VS Code then shows a code and opens your browser; approve it there.

The token is kept in your system keychain and is only ever sent to the address that issued it. Changing `bldt.url` signs you out. You can disconnect this editor any time from bld.t Settings, under Sessions.

## Privacy

Choose what teammates see with `bldt.presence.share`: `file` (default), `branch`, or `off`. It is a user setting, so a repository's workspace settings cannot change it. **bld.t: Toggle invisible** hides you immediately, in every window, and stays on until you toggle it again. Nothing is shared while you are signed out, and you drop off after 20 minutes without activity. With several windows open, only the one you are using shares presence.

## Settings

| Setting | Default | |
|---|---|---|
| `bldt.url` | empty (asked for at sign-in) | Your bld.t address |
| `bldt.presence.share` | `file` | What teammates can see |
| `bldt.notifications` | `true` | Show bld.t notifications in VS Code |

## Publishing

`pnpm publish:openvsx` builds the package and publishes it to Open VSX. It needs an Open VSX access token in the `OVSX_PAT` environment variable.

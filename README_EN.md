# Server Plugin Switch

[中文](README.md)

Server Plugin Switch is a SillyTavern tool for server-plugin enable/disable switching and restart orchestration.
It consists of one server plugin plus one in-app extension panel.

It does **not** hot-load or hot-unload plugins in the current process.
It only manages whether a plugin should be loaded on the next startup, then handles the restart step.

Runtime config is stored at:

- `data/.server-plugin-switch/config.json`

## When You Need It

- you have several server plugins and want to toggle them inside SillyTavern instead of renaming files manually
- you already know a restart is required after switching, but you do not want to remember commands every time
- some of your environments can auto-respawn while others require manual startup commands, and you want one consistent entry point

## Features

- **Server-plugin listing** for the current `plugins/` directory
- **Enable / disable switching** for next startup only, without touching already-loaded runtime instances
- **Safe directory-plugin disable flow** that handles both `package.json main` and root fallback entries `index.js / index.cjs / index.mjs`
- **Safe single-file plugin disable flow** by renaming the plugin file to `*.spm-disabled`
- **Auto restart mode** that exits the current process and relies on Docker / `pm2` / `systemd` / external keepalive
- **Custom command mode** that stores a user-defined startup command, spawns it detached, then exits the old process
- **Command preflight** using `sh -n` on POSIX and at least shell availability checks on Windows
- **Last-result reporting** for the latest preflight or restart scheduling result
- **Installer scripts** for one-step install and uninstall

## Quick Install

```bash
git clone https://github.com/Asobi-123/server-plugin-switch.git
cd server-plugin-switch
node install.mjs
```

- the installer auto-detects nearby SillyTavern directories
- if multiple targets are found, it asks you to choose one in the terminal
- the script does not auto-restart SillyTavern; restart it yourself after installation

## What The Installer Does

- auto-detect the SillyTavern root directory
- prefer installing the extension panel into `data/<user>/extensions/server-plugin-switch`
- install the server plugin into `plugins/server-plugin-switch`
- set `enableServerPlugins: true` in `config.yaml`
- clean same-name leftovers before reinstall
- keep `data/.server-plugin-switch/config.json` untouched

## Explicit Path Install

If you do not want auto-detection, pass the path directly:

```bash
node install.mjs /path/to/SillyTavern
```

Or use an environment variable:

```bash
SILLYTAVERN_DIR=/path/to/SillyTavern node install.mjs
```

## Uninstall

```bash
node uninstall.mjs
```

Or:

```bash
node uninstall.mjs /path/to/SillyTavern
```

The uninstall script removes the extension directory and `plugins/server-plugin-switch`.
It does not delete `data/.server-plugin-switch/config.json`.

## Usage

1. restart SillyTavern
2. open `Server Plugin Switch` inside the extension settings drawer
3. use the **Plugins** tab to inspect server plugins and toggle enable/disable state
4. use the **Restart** tab to choose `Auto` or `Custom Command` mode
5. when needed, run **Test Command** first, then trigger **Restart SillyTavern**

## Data Layout

### Install Locations

- Extension panel: `data/<user>/extensions/server-plugin-switch`
- Server plugin: `plugins/server-plugin-switch`

### Runtime Data

- Config root: `data/.server-plugin-switch/`
- Main config: `config.json`

## Environment Matrix

| Environment | Recommended Mode | Expected Behavior | Boundary |
| --- | --- | --- | --- |
| Docker | Auto | exit current process and rely on container restart policy | no restart policy means it will not come back automatically |
| macOS | Custom command | launch a new process using the user's own startup command | a bad command will fail to start |
| Windows | Custom command | invoke the user command through `cmd.exe` | a bad command can create duplicate instances |
| VPS | Auto or custom | use auto with a supervisor, custom without one | never assume “comes back automatically” by default |
| termux | Auto or custom | auto with keepalive, custom for manual setups | manual termux cannot rely on exit-only recovery |

## FAQ

**Q: Why not support hot enable/disable inside the current process?**

Because SillyTavern's server-plugin loader is not built as a hot-plug manager.
This project intentionally manages only next-startup state.

**Q: Why is restart always required after switching?**

Because the project changes whether the plugin entry can still be discovered by the loader.
Already-loaded runtime instances stay alive until the process restarts.

**Q: Why can't I install only the extension panel?**

Because listing, switching, and restart orchestration all live on the server-plugin side.
The front-end is only a panel.

**Q: Will uninstall remove my config?**

No.
By default the uninstall script removes only the extension directory and the plugin directory.

**Q: How do I update it?**

```bash
cd /path/to/server-plugin-switch
git pull
node install.mjs
```

**Q: How do I choose between Auto and Custom Command mode?**

Use `Auto` when an external supervisor already exists.
Use `Custom Command` for manual local terminals, VPS setups without a supervisor, and manual termux environments.

## Related Docs

- **Changelog** — [CHANGELOG.md](CHANGELOG.md)
- **Architecture** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Data Model** — [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- **Manual Testing Checklist** — [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md)
- **Troubleshooting** — [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## License

[AGPL-3.0](LICENSE)

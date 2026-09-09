/**
 * The opencode2 host (beta-18743 through beta-19059) validates a TUI module as
 * `default: { id: string, setup: function }` (`S9t` / "Invalid V2 TUI plugin
 * module" in the binary) and `@opencode-ai/plugin/tui`'s `Plugin.define` is an
 * identity function. Keep that contract local so a package-only SDK update
 * cannot make every configured TUI module fail before setup.
 */
export const Plugin = {
  define<T extends { id: string; setup: (context: any) => unknown }>(plugin: T): T { return plugin },
}

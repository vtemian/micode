import type { Plugin as PluginV2 } from "@opencode/plugin";
import type { Plugin as PluginV1 } from "@opencode-ai/plugin";

import { server, setup } from "@/host";

/**
 * One default export for both hosts. OpenCode 1 (1.18.29 or newer) calls
 * `server()` and uses the hooks it returns; OpenCode 2 reads `id` and calls
 * `setup()`. Never add a `tui` key here: v1 rejects modules that define both
 * `server` and `tui`.
 */
interface MicodeModule extends PluginV2.Plugin {
  readonly server: PluginV1;
}

const Micode: MicodeModule = {
  id: "micode",
  setup,
  server,
};

export default Micode;

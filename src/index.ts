import { ExtensionContext } from "@foxglove/extension";

import { initSceneSearchPanel } from "./SceneSearchPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "Scene Search", initPanel: initSceneSearchPanel });
}

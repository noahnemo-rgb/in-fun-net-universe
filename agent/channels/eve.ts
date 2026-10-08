import { eveChannel } from "eve/channels/eve";
import { none, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    vercelOidc(),
    // Public scene. The presence holds no private data and has no tools.
    none(),
  ],
});

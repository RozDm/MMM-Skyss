// Ambient declarations for globals/modules that MagicMirror² provides at runtime.
// They are not bundled in this repository, so we declare them loosely so that
// `// @ts-check` can verify the rest of the code without false "cannot find" errors.

declare const Module: any;
declare const Log: any;
declare const MM: any;
declare const config: any;
declare const moment: any;

declare module "node_helper" {
    const NodeHelper: any;
    export = NodeHelper;
}

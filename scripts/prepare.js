"use strict";

/*
 * npm "prepare" script: installs the husky pre-commit hook for contributors.
 * husky is a devDependency, so an end user's `npm install --omit=dev` (or an
 * update tool doing the same) does not have it; that must not fail the install.
 */

import("husky").then(
    (husky) => {
        const message = husky.default();
        if (message) console.log(message);
    },
    () => {
        // husky is not installed (production install): nothing to set up.
    }
);

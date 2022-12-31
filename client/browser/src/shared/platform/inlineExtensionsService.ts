import { Observable, from, of } from 'rxjs'

import { checkOk } from '@sourcegraph/http-client'
import { ExecutableExtension } from '@sourcegraph/shared/src/api/extension/activation'
import { ExtensionManifest } from '@sourcegraph/shared/src/extensions/extensionManifest'

import extensions from '../../../code-intel-extensions.json'

const DEFAULT_ENABLE_LEGACY_EXTENSIONS = false

export const shouldUseInlineExtensions = (): Observable<boolean> => {
    // TODO: The Phabricator native extension is currently the only runtime that runs the
    // browser extension code but does not use bundled extensions yet. We will fix this
    // when we update the browser extensions to use the new code intel APIs (#42104).
    if (window.SOURCEGRAPH_PHABRICATOR_EXTENSION === true) {
        throw new Error('not supported')
    }
    return of(DEFAULT_ENABLE_LEGACY_EXTENSIONS)
}

/**
 * Get the manifest URL and script URL for a Sourcegraph extension which is inline (bundled with the browser add-on).
 */
function getURLsForInlineExtension(extensionID: string): { manifestURL: string; scriptURL: string } {
    const kebabCaseExtensionID = extensionID.replace(/^sourcegraph\//, 'sourcegraph-')

    const manifestPath = `extensions/${kebabCaseExtensionID}/package.json`
    const scriptPath = `extensions/${kebabCaseExtensionID}/extension.js`

    // In a browser extension environment, we need to find the absolute ULR in the browser extension
    // asssets directory.
    if (typeof window.browser !== 'undefined') {
        return {
            manifestURL: browser.extension.getURL(manifestPath),
            scriptURL: browser.extension.getURL(scriptPath),
        }
    }
    // If SOURCEGRAPH_ASSETS_URL is defined (happening for e.g. GitLab native extenisons), we can
    // use this URL as the root for bundled assets.
    if (window.SOURCEGRAPH_ASSETS_URL) {
        return {
            manifestURL: new URL(manifestPath, window.SOURCEGRAPH_ASSETS_URL).toString(),
            scriptURL: new URL(scriptPath, window.SOURCEGRAPH_ASSETS_URL).toString(),
        }
    }

    throw new Error('Can not construct extension URLs')
}

export function getInlineExtensions(): Observable<ExecutableExtension[]> {
    const promises: Promise<ExecutableExtension>[] = []

    for (const extensionID of extensions) {
        const { manifestURL, scriptURL } = getURLsForInlineExtension(extensionID)
        promises.push(
            fetch(manifestURL)
                .then(response => checkOk(response).json())
                .then(
                    (manifest: ExtensionManifest): ExecutableExtension => ({
                        id: extensionID,
                        manifest,
                        scriptURL,
                    })
                )
        )
    }

    return from(Promise.all(promises))
}

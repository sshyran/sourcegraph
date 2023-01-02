import { castArray } from 'lodash'
import { Observable, of } from 'rxjs'
import { defaultIfEmpty, map } from 'rxjs/operators'

import {
    fromHoverMerged,
    HoverMerged,
    TextDocumentIdentifier,
    TextDocumentPositionParameters,
} from '@sourcegraph/client-api'
// eslint-disable-next-line no-restricted-imports
import { isDefined } from '@sourcegraph/common/src/types'
import { Location } from '@sourcegraph/extension-api-types'

import { match } from '../api/client/types/textDocument'
import { getModeFromPath } from '../languages'
import type { PlatformContext } from '../platform/context'
import { isSettingsValid, Settings, SettingsCascade } from '../settings/settings'
import { parseRepoURI } from '../util/url'

import {
    CodeIntelContext,
    DocumentHighlight,
    ReferenceContext,
    DocumentSelector,
    updateCodeIntelContext,
    ProviderResult,
    Definition,
    TextDocument,
    Position,
    SettingsGetter,
} from './legacy-extensions/api'
import { LanguageSpec } from './legacy-extensions/language-specs/language-spec'
import { languageSpecs } from './legacy-extensions/language-specs/languages'
import { RedactingLogger } from './legacy-extensions/logging'
import { createProviders, emptySourcegraphProviders, SourcegraphProviders } from './legacy-extensions/providers'

interface CodeIntelAPI {
    hasReferenceProvidersForDocument(textParameters: TextDocumentPositionParameters): Observable<boolean>
    getDefinition(textParameters: TextDocumentPositionParameters): Observable<Location[]>
    getReferences(textParameters: TextDocumentPositionParameters, context: ReferenceContext): Observable<Location[]>
    getImplementations(parameters: TextDocumentPositionParameters): Observable<Location[]>
    getHover(textParameters: TextDocumentPositionParameters): Observable<HoverMerged | null>
    getDocumentHighlights(textParameters: TextDocumentPositionParameters): Observable<DocumentHighlight[]>
}

function createCodeIntelAPI(context: CodeIntelContext): CodeIntelAPI {
    updateCodeIntelContext(context)
    return new DefaultCodeIntelAPI()
}

export let codeIntelAPI: null | CodeIntelAPI = null
export async function getOrCreateCodeIntelAPI(context: PlatformContext): Promise<CodeIntelAPI> {
    if (codeIntelAPI !== null) {
        return codeIntelAPI
    }

    return new Promise<CodeIntelAPI>((resolve, reject) => {
        context.settings.subscribe(settingsCascade => {
            try {
                if (!isSettingsValid(settingsCascade)) {
                    throw new Error('Settings are not valid')
                }
                codeIntelAPI = createCodeIntelAPI({
                    requestGraphQL: context.requestGraphQL,
                    telemetryService: context.telemetryService,
                    settings: newSettingsGetter(settingsCascade),
                })
                resolve(codeIntelAPI)
            } catch (error) {
                reject(error)
            }
        })
    })
}

class DefaultCodeIntelAPI implements CodeIntelAPI {
    private locationResult(locations: ProviderResult<Definition>): Observable<Location[]> {
        return locations.pipe(
            defaultIfEmpty(),
            map(result =>
                castArray(result)
                    .filter(isDefined)
                    .map(location => ({ ...location, uri: location.uri.toString() }))
            )
        )
    }

    public hasReferenceProvidersForDocument(textParameters: TextDocumentPositionParameters): Observable<boolean> {
        const document = toTextDocument(textParameters.textDocument)
        const providers = findLanguageMatchingDocument(document)?.providers
        return of(!!providers)
    }
    public getReferences(
        textParameters: TextDocumentPositionParameters,
        context: ReferenceContext
    ): Observable<Location[]> {
        const request = requestFor(textParameters)
        return this.locationResult(
            request.providers.references.provideReferences(request.document, request.position, context)
        )
    }
    public getDefinition(textParameters: TextDocumentPositionParameters): Observable<Location[]> {
        const request = requestFor(textParameters)
        return this.locationResult(request.providers.definition.provideDefinition(request.document, request.position))
    }
    public getImplementations(textParameters: TextDocumentPositionParameters): Observable<Location[]> {
        const request = requestFor(textParameters)
        return this.locationResult(
            request.providers.implementations.provideLocations(request.document, request.position)
        )
    }
    public getHover(textParameters: TextDocumentPositionParameters): Observable<HoverMerged | null> {
        const request = requestFor(textParameters)
        return (
            request.providers.hover
                .provideHover(request.document, request.position)
                // We intentionally don't use `defaultIfEmpty()` here because
                // that makes the popover load with an empty docstring.
                .pipe(map(result => fromHoverMerged([result])))
            // TODO(sqs): when the provider yields nothing, the observable appears to be empty, so undefined is returned, this means there is an error thrown in the devtools console when you hover over something like `switch` or some other syntactical element that lacks a hover
        )
    }
    public getDocumentHighlights(textParameters: TextDocumentPositionParameters): Observable<DocumentHighlight[]> {
        const request = requestFor(textParameters)
        return request.providers.documentHighlights.provideDocumentHighlights(request.document, request.position).pipe(
            defaultIfEmpty(),
            map(result => result || [])
        )
    }
}

interface LanguageRequest {
    providers: SourcegraphProviders
    document: TextDocument
    position: Position
}

function requestFor(textParameters: TextDocumentPositionParameters): LanguageRequest {
    const document = toTextDocument(textParameters.textDocument)
    return {
        document,
        position: textParameters.position,
        providers: findLanguageMatchingDocument(document)?.providers || emptySourcegraphProviders,
    }
}

function toTextDocument(textDocument: TextDocumentIdentifier): TextDocument {
    return {
        uri: textDocument.uri,
        languageId: getModeFromPath(parseRepoURI(textDocument.uri).filePath || ''),
        text: undefined,
    }
}

function findLanguageMatchingDocument(textDocument: TextDocumentIdentifier): Language | undefined {
    const document: Pick<TextDocument, 'uri' | 'languageId'> = toTextDocument(textDocument)
    for (const language of languages) {
        if (match(language.selector, document)) {
            return language
        }
    }
    return undefined
}

interface Language {
    spec: LanguageSpec
    selector: DocumentSelector
    providers: SourcegraphProviders
}
const hasImplementationsField = true
const languages: Language[] = languageSpecs.map(spec => ({
    spec,
    selector: selectorForSpec(spec),
    providers: createProviders(spec, hasImplementationsField, new RedactingLogger(console)),
}))

// Returns true if the provided language supports "Find implementations"
export function hasFindImplementationsSupport(language: string): boolean {
    for (const spec of languageSpecs) {
        if (spec.languageID === language) {
            return spec.textDocumentImplemenationSupport ?? false
        }
    }
    return false
}

function selectorForSpec(languageSpec: LanguageSpec): DocumentSelector {
    return [
        { language: languageSpec.languageID },
        ...(languageSpec.verbatimFilenames || []).flatMap(filename => [{ pattern: filename }]),
        ...languageSpec.fileExts.flatMap(extension => [{ pattern: `*.${extension}` }]),
    ]
}

function newSettingsGetter(settingsCascade: SettingsCascade<Settings>): SettingsGetter {
    return <T>(setting: string): T | undefined =>
        settingsCascade.final && (settingsCascade.final[setting] as T | undefined)
}

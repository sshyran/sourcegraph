// IMPORTANT: This module contains code used by the CodeMirror query input
// implementation and therefore shouldn't have any runtime dependencies on
// Monaco

import { Observable, of } from 'rxjs'
import { delay, takeUntil, switchMap } from 'rxjs/operators'

import { SearchMatch } from '../stream'

import { FilterType } from './filters'
import { scanSearchQuery } from './scanner'
import { Filter, KeywordKind, Token } from './token'
import { isFilterType } from './validate'

const MAX_SUGGESTION_COUNT = 50
const REPO_SUGGESTION_FILTERS = [FilterType.fork, FilterType.visibility, FilterType.archived]
const FILE_SUGGESTION_FILTERS = [...REPO_SUGGESTION_FILTERS, FilterType.repo, FilterType.rev, FilterType.lang]
export type ParseRepoURLFunction = (url: string) => { repoName?: string; filePath?: string }

function serializeFilters(tokens: Token[], filterTypes: FilterType[]): string {
    return tokens
        .filter((token): token is Filter => filterTypes.some(filterType => isFilterType(token, filterType)))
        .map(filter => (filter.value ? `${filter.field.value}:${filter.value.value}` : ''))
        .filter(serialized => !!serialized)
        .join(' ')
}

function stripPrefix(value: string, prefix: string): string {
    if (value.startsWith(prefix)) {
        return value.slice(prefix.length)
    }
    return value
}

function formatAsSourcegraphRepoURL(url: string): string {
    url = stripPrefix(url, 'https:/')
    if (url.includes('/blob/') && !url.includes('/-/blob/')) {
        // ASSUMPTION: this is a GitHub URL and we try to extract as much
        // information as possible without false negatives. There's no way to
        // separate the revision from the file path in GitHub URLs. The only
        // thing we know for sure is that the last part is a filename. Using
        // only the filename risks false positives when the repo has multiple
        // files with the same name, but it's still better than showing no
        // suggestions (which is what happens if we don't try to guess the URL).
        // The long-term fix for this would be to add search syntax to accept an
        // arbitrary URL and let the backend resolve the revision/filepath by
        // sending a request to the code host.
        const filename = url.split('/').slice(-1)[0]
        return url.replace(/\/blob\/.*/, `/-/blob/${filename}`)
    }
    return url
}

/**
 * getSuggestionsQuery might return an empty query. The caller is responsible
 * for handling this accordingly.
 */
export function getSuggestionQuery(
    tokens: Token[],
    tokenAtColumn: Token,
    suggestionType: SearchMatch['type'],
    parseRepoURL?: ParseRepoURLFunction
): string {
    const hasAndOrOperators = tokens.some(
        token => token.type === 'keyword' && (token.kind === KeywordKind.Or || token.kind === KeywordKind.And)
    )

    let tokenValue = ''

    switch (tokenAtColumn.type) {
        case 'filter':
            tokenValue = tokenAtColumn.value?.value ?? ''
            break
        case 'pattern':
            tokenValue = tokenAtColumn.value
            break
    }

    if (!tokenValue) {
        return ''
    }
    console.log({ parsed: parseRepoURL?.('github.com/sourcegraph/scip-typescript/-/blob/src/main.test.ts') })

    // Remove 'https://' prefix per https://twitter.com/mitchellh/status/1610353274540130304
    if (parseRepoURL && suggestionType === 'repo') {
        tokenValue = formatAsSourcegraphRepoURL(tokenValue)
        const { repoName, filePath } = parseRepoURL(tokenValue)
        if (filePath) {
            suggestionType = 'path'
            tokenValue = filePath
            const repoTokens = scanSearchQuery(`repo:${repoName}`)
            if (repoTokens.type === 'success') {
                tokens.push(...repoTokens.term)
            }
        }
        console.log({ tokenValue, suggestionType, repoName, filePath })
    }

    if (suggestionType === 'repo') {
        const relevantFilters = !hasAndOrOperators ? serializeFilters(tokens, REPO_SUGGESTION_FILTERS) : ''
        return `${relevantFilters} repo:${tokenValue} type:repo count:${MAX_SUGGESTION_COUNT}`.trimStart()
    }

    // For the cases below, we are not handling queries with and/or operators. This is because we would need to figure out
    // for each filter which filters from the surrounding expression apply to it. For example, if we have a query: `repo:x file:y z OR repo:xx file:yy`
    // and we want to get suggestions for the `file:yy` filter. We would only want to include file suggestions from the `xx` repo and not the `x` repo, because it
    // is a part of a different expression.
    if (hasAndOrOperators) {
        return ''
    }

    if (suggestionType === 'path') {
        const relevantFilters = serializeFilters(tokens, FILE_SUGGESTION_FILTERS)
        return `${relevantFilters} file:${tokenValue} type:path count:${MAX_SUGGESTION_COUNT}`.trimStart()
    }
    if (suggestionType === 'symbol') {
        const relevantFilters = serializeFilters(tokens, [...FILE_SUGGESTION_FILTERS, FilterType.file])
        return `${relevantFilters} ${tokenValue} type:symbol count:${MAX_SUGGESTION_COUNT}`.trimStart()
    }

    return ''
}

export function createCancelableFetchSuggestions(
    fetchSuggestions: (query: string) => Observable<SearchMatch[]>
): (query: string, onAbort: (hander: () => void) => void) => Promise<SearchMatch[]> {
    return (query, onAbort) => {
        if (!query) {
            // Don't fetch suggestions if the query is empty. This would result
            // in arbitrary result types being returned, which is unexpected.
            return Promise.resolve([])
        }

        let aborted = false

        // By listeing to the abort event of the autocompletion we
        // can close the connection to server early and don't have to download
        // data sent by the server.
        const abort = new Observable(subscriber => {
            onAbort(() => {
                aborted = true
                subscriber.next(null)
                subscriber.complete()
            })
        })

        return (
            of(query)
                .pipe(
                    // We use a delay here to implement a custom debounce. In the
                    // next step we check if the current completion request was
                    // cancelled in the meantime.
                    // This prevents us from needlessly running multiple suggestion
                    // queries.
                    delay(150),
                    switchMap(query => (aborted ? Promise.resolve([]) : fetchSuggestions(query))),
                    takeUntil(abort)
                )
                // toPromise may return undefined if the observable completes before
                // a value was emitted . The return type was fixed in newer versions
                // (and the method was actually deprecated).
                // See https://rxjs.dev/deprecations/to-promise
                .toPromise()
                .then(result => result ?? [])
        )
    }
}

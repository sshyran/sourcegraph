import classNames from 'classnames'
import React from 'react'

import { LoadingSpinner } from '@sourcegraph/react-loading-spinner'
import { Scalars } from '@sourcegraph/shared/src/graphql-operations'
import { useQuery } from '@sourcegraph/shared/src/graphql/apollo'

import { CatalogGraphResult, CatalogGraphVariables } from '../../../../../../graphql-operations'
import { EntityGraph } from '../../../../components/entity-graph/EntityGraph'
import { ComponentFiltersProps } from '../../../../core/entity-filters'

import { CATALOG_GRAPH } from './gql'

interface Props extends Pick<ComponentFiltersProps, 'filters'> {
    highlightID?: Scalars['ID']
    queryScope?: string
    className?: string
    errorClassName?: string
}

export const OverviewEntityGraph: React.FunctionComponent<Props> = ({
    filters,
    highlightID,
    queryScope,
    className,
    errorClassName,
}) => {
    const { data, error, loading } = useQuery<CatalogGraphResult, CatalogGraphVariables>(CATALOG_GRAPH, {
        variables: {
            query: `${queryScope || ''} ${filters.query || ''}`,
        },

        // Cache this data but always re-request it in the background when we revisit
        // this page to pick up newer changes.
        fetchPolicy: 'cache-and-network',

        // For subsequent requests while this page is open, make additional network
        // requests; this is necessary for `refetch` to actually use the network. (see
        // https://github.com/apollographql/apollo-client/issues/5515)
        nextFetchPolicy: 'network-only',
    })

    return error ? (
        <div className={classNames('alert alert-error', errorClassName)}>Error loading graph</div>
    ) : loading && !data ? (
        <LoadingSpinner className="icon-inline" />
    ) : !data || !data.graph ? (
        <div className={classNames('alert alert-error', errorClassName)}>Catalog graph is not available</div>
    ) : data.graph.nodes.length > 0 ? (
        <EntityGraph
            graph={{
                ...data.graph,
                edges: data.graph.edges.filter(edge => edge.type === 'DEPENDS_ON'),
            }}
            activeNodeID={highlightID}
            className={className}
        />
    ) : (
        <p className={classNames('text-muted mb-0', errorClassName)}>Empty graph</p>
    )
}

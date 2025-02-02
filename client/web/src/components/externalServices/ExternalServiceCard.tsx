import React from 'react'

import { mdiChevronRight } from '@mdi/js'
import classNames from 'classnames'

import { Icon, Link, H3, Text, Tooltip, Badge } from '@sourcegraph/wildcard'

import { ExternalServiceKind } from '../../graphql-operations'

import styles from './ExternalServiceCard.module.scss'

interface ExternalServiceCardProps {
    /**
     * Title to show in the external service "button".
     */
    title: string

    /**
     * Icon to show in the external service "button".
     */
    icon: React.ComponentType<React.PropsWithChildren<{ className?: string }>>

    /**
     * A short description that will appear in the external service "button" under the title.
     */
    shortDescription?: string

    kind: ExternalServiceKind

    to?: string

    /**
     * ToIcon is an icon shown on the right-hand side of the card. Default value is right-pointed chevron.
     */
    toIcon?: string | undefined | null
    className?: string
    enabled?: boolean
    badge?: string
    tooltip?: string
    bordered?: boolean
}

export const ExternalServiceCard: React.FunctionComponent<React.PropsWithChildren<ExternalServiceCardProps>> = ({
    title,
    icon: CardIcon,
    shortDescription,
    to,
    toIcon = mdiChevronRight,
    kind,
    className = '',
    enabled = true,
    badge = '',
    tooltip = '',
    bordered = true,
}) => {
    let cardTitle = <H3 className={shortDescription ? 'mb-0' : 'mt-1 mb-0'}>{title}</H3>
    cardTitle = tooltip ? <Tooltip content={tooltip}>{cardTitle}</Tooltip> : cardTitle
    const children = (
        <div
            className={classNames(
                'd-flex align-items-start' + (bordered ? ' p-3 border' : ' p-1') + (enabled ? '' : ' text-muted'),
                className
            )}
        >
            <Icon
                disabled={!enabled}
                className={classNames('mb-0 mr-3', styles.icon)}
                as={CardIcon}
                aria-hidden={true}
            />
            <div>
                {cardTitle}
                {shortDescription && <Text className="mb-0 text-muted">{shortDescription}</Text>}
            </div>
            <div className="flex-1 align-self-center">
                {to && enabled && toIcon && (
                    <Icon className="float-right" svgPath={toIcon} inline={false} aria-hidden={true} />
                )}
                {badge && (
                    <Badge className="float-right" variant="outlineSecondary">
                        {badge.toUpperCase()}
                    </Badge>
                )}
            </div>
        </div>
    )
    return to && enabled ? (
        <Link
            className="d-block text-left text-body text-decoration-none"
            to={to}
            data-test-external-service-card-link={kind}
        >
            {children}
        </Link>
    ) : (
        children
    )
}

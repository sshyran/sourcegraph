import { VirtualElement, Strategy } from '@floating-ui/core'
import { Options as OffsetOptions } from '@floating-ui/core/src/middleware/offset'
import { flip, getScrollParents, size, autoPlacement, hide, limitShift, Middleware, offset, shift } from '@floating-ui/dom'

export type Target = Element | VirtualElement

interface PositionMiddlewaresInput {
    target: Target
    floating: HTMLElement
    strategy: Strategy
    padding?: OffsetOptions
    constraints?: (Element | Window | VisualViewport)[]
}

/**
 * Returns a list of position middlewares for proper floating panel (popover) position
 * See https://floating-ui.com/docs/middleware for details and examples.
 */
export function getPositionMiddlewares(input: PositionMiddlewaresInput): Middleware[] {
    const { strategy, constraints, padding = 0, floating } = input
    const boundary = (constraints ?? getScrollConstraints(input)) as Element[]

    switch (strategy) {
        case 'absolute':
            return [shift({ limiter: limitShift(), boundary }), offset(padding), flip({ boundary })]
        case 'fixed':
            return [
                autoPlacement({
                    boundary,
                    alignment: 'start',
                    autoAlignment: false,
                }),
                shift({ limiter: limitShift(), boundary,  }),
                size({
                    apply({width}) {
                        Object.assign(floating.style, {
                            maxWidth: `${width}px`,
                            // maxHeight: `${height}px`
                        });
                    },
                    // padding: 20
                    //  padding: { bottom: 20, left: 20, top: 20, right: 20 }
                }),
                offset(padding),
                hide()
            ]
    }
}

interface ScrollConstraintsInput {
    target: Target
    floating: HTMLElement
    strategy: Strategy
}

type ConstraintElement = Element | Window | VisualViewport

/**
 * Returns array of scrollable elements for target and floating elements
 * according to position settings and target type.
 */
export function getScrollConstraints(input: ScrollConstraintsInput): ConstraintElement[] {
    const { target, floating, strategy } = input

    // floating element itself could be a scrollable block but it
    // isn't needed for position calculation (in fact it breaks it)
    // So include only scroll parents.
    const floatingScrollParents = floating.parentElement ? getScrollParents(floating.parentElement) : []

    // With the 'absolute' strategy floating element is rendered outside of target
    // tree so we have to ignore target scroll containers constraints in this case.
    const targetScrollParents = isElement(target) && strategy === 'absolute' ? getScrollParents(target) : []

    return [...targetScrollParents, ...floatingScrollParents]
}

export function isElement(value: unknown): value is Element {
    return value instanceof window.Element
}

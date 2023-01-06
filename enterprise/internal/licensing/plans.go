package licensing

import (
	"strings"

	"github.com/sourcegraph/sourcegraph/lib/errors"
)

// A Plan is a pricing plan, with an associated set of features that it offers.
type Plan string

// GetFeature returns the plan's configured feature.
// It returns nil if the feature is not configured for the plan.
func (p Plan) GetFeature(feature Feature) Feature {
	for _, f := range planFeatures[p] {
		if feature.FeatureName() == f.FeatureName() {
			return f
		}
	}
	return nil
}

const planTagPrefix = "plan:"

// tag is the representation of the plan as a tag in a license key.
func (p Plan) tag() string { return planTagPrefix + string(p) }

// isKnown reports whether the plan is a known plan.
func (p Plan) isKnown() bool {
	for _, plan := range allPlans {
		if p == plan {
			return true
		}
	}
	return false
}

// Plan is the pricing plan of the license.
func (info *Info) Plan() Plan {
	for _, tag := range info.Tags {
		// A tag that begins with "plan:" indicates the license's plan.
		if strings.HasPrefix(tag, planTagPrefix) {
			plan := Plan(tag[len(planTagPrefix):])
			if plan.isKnown() {
				return plan
			}
		}

		// Backcompat: support the old "starter" tag (which mapped to "Enterprise Starter").
		if tag == "starter" {
			return PlanOldEnterpriseStarter
		}
	}

	// Backcompat: no tags means it is the old "Enterprise" plan.
	return PlanOldEnterprise
}

// hasUnknownPlan returns an error if the plan is presented in the license tags
// but unrecognizable. It returns nil if there is no tags found for plans.
func (info *Info) hasUnknownPlan() error {
	for _, tag := range info.Tags {
		// A tag that begins with "plan:" indicates the license's plan.
		if !strings.HasPrefix(tag, planTagPrefix) {
			continue
		}

		plan := Plan(tag[len(planTagPrefix):])
		if !plan.isKnown() {
			return errors.Errorf("The license has an unrecognizable plan in tag %q, please contact Sourcegraph support.", tag)
		}
	}
	return nil
}

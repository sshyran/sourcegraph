package store

import (
	"fmt"

	"github.com/sourcegraph/sourcegraph/internal/metrics"
	"github.com/sourcegraph/sourcegraph/internal/observation"
)

type operations struct {
	// Configurations
	getConfigurationPolicies      *observation.Operation
	getConfigurationPolicyByID    *observation.Operation
	createConfigurationPolicy     *observation.Operation
	updateConfigurationPolicy     *observation.Operation
	deleteConfigurationPolicyByID *observation.Operation

	// Repositories
	getRepoIDsByGlobPatterns                    *observation.Operation
	updateReposMatchingPatterns                 *observation.Operation
	selectPoliciesForRepositoryMembershipUpdate *observation.Operation
}

var m = new(metrics.SingletonREDMetrics)

func newOperations(observationCtx *observation.Context) *operations {
	m := m.Get(func() *metrics.REDMetrics {
		return metrics.NewREDMetrics(
			observationCtx.Registerer,
			"codeintel_policies_store",
			metrics.WithLabels("op"),
			metrics.WithCountHelp("Total number of method invocations."),
		)
	})

	op := func(name string) *observation.Operation {
		return observationCtx.Operation(observation.Op{
			Name:              fmt.Sprintf("codeintel.policies.store.%s", name),
			MetricLabelValues: []string{name},
			Metrics:           m,
		})
	}

	return &operations{
		// Configurations
		getConfigurationPolicies:      op("GetConfigurationPolicies"),
		getConfigurationPolicyByID:    op("GetConfigurationPolicyByID"),
		createConfigurationPolicy:     op("CreateConfigurationPolicy"),
		updateConfigurationPolicy:     op("UpdateConfigurationPolicy"),
		deleteConfigurationPolicyByID: op("DeleteConfigurationPolicyByID"),

		// Repositories
		updateReposMatchingPatterns:                 op("UpdateReposMatchingPatterns"),
		getRepoIDsByGlobPatterns:                    op("GetRepoIDsByGlobPatterns"),
		selectPoliciesForRepositoryMembershipUpdate: op("SelectPoliciesForRepositoryMembershipUpdate"),
	}
}

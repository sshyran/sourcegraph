// @flow weak

import React from "react";

import AuthorList from "sourcegraph/def/AuthorList";
import Container from "sourcegraph/Container";
import DefStore from "sourcegraph/def/DefStore";
import RefsContainer from "sourcegraph/def/RefsContainer";
import {Link} from "react-router";
import "sourcegraph/blob/BlobBackend";
import Dispatcher from "sourcegraph/Dispatcher";
import * as DefActions from "sourcegraph/def/DefActions";
import {urlToDef} from "sourcegraph/def/routes";
import CSSModules from "react-css-modules";
import styles from "./styles/DefInfo.css";
import {qualifiedNameAndType} from "sourcegraph/def/Formatter";
import Header from "sourcegraph/components/Header";
import httpStatusCode from "sourcegraph/util/httpStatusCode";

class DefInfo extends Container {
	static contextTypes = {
		router: React.PropTypes.object.isRequired,
		features: React.PropTypes.object.isRequired,
	};

	constructor(props) {
		super(props);
	}

	stores() {
		return [DefStore];
	}

	componentDidMount() {
		if (super.componentDidMount) super.componentDidMount();
		// Fix a bug where navigating from a blob page here does not cause the
		// browser to scroll to the top of this page.
		if (typeof window !== "undefined") window.scrollTo(0, 0);
	}

	reconcileState(state, props) {
		state.repo = props.repo || null;
		state.rev = props.rev || null;
		state.def = props.def || null;
		state.defObj = props.defObj || null;
		state.defCommitID = props.defObj ? props.defObj.CommitID : null;
		state.refLocations = state.def ? DefStore.refLocations.get(state.repo, state.rev, state.def) : null;
		state.authors = state.defObj ? DefStore.authors.get(state.repo, state.defObj.CommitID, state.def) : null;
	}

	onStateTransition(prevState, nextState) {
		if (nextState.repo !== prevState.repo || nextState.rev !== prevState.rev || nextState.def !== prevState.def) {
			Dispatcher.Backends.dispatch(new DefActions.WantRefLocations(nextState.repo, nextState.rev, nextState.def));
		}

		if (prevState.defCommitID !== nextState.defCommitID && nextState.defCommitID) {
			if (this.context.features.Authors) {
				Dispatcher.Backends.dispatch(new DefActions.WantDefAuthors(nextState.repo, nextState.defCommitID, nextState.def));
			}
		}
	}

	render() {
		let def = this.state.defObj;
		let refLocs = this.state.refLocations;

		if (refLocs && refLocs.Error) {
			return (
				<Header
					title={`${httpStatusCode(refLocs.Error)}`}
					subtitle={`References are not available.`} />
			);
		}

		return (
			<div styleName="container">
				{this.state.defObj &&
					<h1>
						<Link to={urlToDef(this.state.defObj)}>
							<code styleName="def-title">{qualifiedNameAndType(this.state.defObj, {unqualifiedNameClass: styles.def})}</code>
						</Link>
					</h1>
				}
				<hr/>
				<div styleName="main">
					{this.state.authors && <AuthorList authors={this.state.authors} horizontal={true} />}
					{def && def.DocHTML && <div styleName="description" dangerouslySetInnerHTML={def.DocHTML}></div>}
					{def && !def.Error &&
						<div>
							<div styleName="section-label">{`Used in ${refLocs ? `${refLocs.length} repositor${refLocs.length > 1 ? "ies" : "y"}` : ""}`}</div>
							{!refLocs && <i>Loading...</i>}
							{refLocs && refLocs.map((refRepo, i) => <RefsContainer {...this.props} key={i}
								refRepo={refRepo.Repo}
								prefetch={i === 0}
								initNumSnippets={i === 0 ? 3 : 0}
								fileCollapseThreshold={5} />)}
						</div>
					}
				</div>
			</div>
		);
	}
}

export default CSSModules(DefInfo, styles);

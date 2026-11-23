/**
 * The distribution functions `calc` exposes, from stdlib
 * (`@stdlib/stats-base-dists-*`: maintained, typed, and ported from Boost and
 * Cephes along with their test suites).
 * Only these names are added to the mathjs instance.
 */

import binomcdf from "@stdlib/stats-base-dists-binomial-cdf";
import binompmf from "@stdlib/stats-base-dists-binomial-pmf";
import binomquantile from "@stdlib/stats-base-dists-binomial-quantile";
import chi2cdf from "@stdlib/stats-base-dists-chisquare-cdf";
import chi2pdf from "@stdlib/stats-base-dists-chisquare-pdf";
import chi2quantile from "@stdlib/stats-base-dists-chisquare-quantile";
import normcdf from "@stdlib/stats-base-dists-normal-cdf";
import normpdf from "@stdlib/stats-base-dists-normal-pdf";
import normquantile from "@stdlib/stats-base-dists-normal-quantile";
import poissoncdf from "@stdlib/stats-base-dists-poisson-cdf";
import poissonpmf from "@stdlib/stats-base-dists-poisson-pmf";
import poissonquantile from "@stdlib/stats-base-dists-poisson-quantile";
import tcdf from "@stdlib/stats-base-dists-t-cdf";
import tpdf from "@stdlib/stats-base-dists-t-pdf";
import tquantile from "@stdlib/stats-base-dists-t-quantile";

export type Fn = (...args: number[]) => number;

/**
 * The distribution allow-list, named the way students write them (TI-84
 * style). Each CDF is P(X ≤ x); each `inv…` is the quantile: the smallest x
 * with P(X ≤ x) ≥ q. Arguments go in the order of the usage string.
 */
export const DISTRIBUTIONS: Record<
	string,
	{ usage: string; fn: Fn; min: number }
> = {
	binompdf: {
		usage: "binompdf(n, p, k)",
		fn: (n, p, k) => binompmf(k, n, p),
		min: 3,
	},
	binomcdf: {
		usage: "binomcdf(n, p, k)",
		fn: (n, p, k) => binomcdf(k, n, p),
		min: 3,
	},
	invbinom: {
		usage: "invbinom(q, n, p)",
		fn: (q, n, p) => binomquantile(q, n, p),
		min: 3,
	},
	poissonpdf: {
		usage: "poissonpdf(λ, k)",
		fn: (l, k) => poissonpmf(k, l),
		min: 2,
	},
	poissoncdf: {
		usage: "poissoncdf(λ, k)",
		fn: (l, k) => poissoncdf(k, l),
		min: 2,
	},
	invpoisson: {
		usage: "invpoisson(q, λ)",
		fn: (q, l) => poissonquantile(q, l),
		min: 2,
	},
	normpdf: {
		usage: "normpdf(x, μ = 0, σ = 1)",
		fn: (x, m, s) => normpdf(x, m ?? 0, s ?? 1),
		min: 1,
	},
	normcdf: {
		usage: "normcdf(x, μ = 0, σ = 1)",
		fn: (x, m, s) => normcdf(x, m ?? 0, s ?? 1),
		min: 1,
	},
	invnorm: {
		usage: "invnorm(q, μ = 0, σ = 1)",
		fn: (q, m, s) => normquantile(q, m ?? 0, s ?? 1),
		min: 1,
	},
	tpdf: { usage: "tpdf(x, ν)", fn: (x, v) => tpdf(x, v), min: 2 },
	tcdf: { usage: "tcdf(x, ν)", fn: (x, v) => tcdf(x, v), min: 2 },
	invt: { usage: "invt(q, ν)", fn: (q, v) => tquantile(q, v), min: 2 },
	chi2pdf: { usage: "chi2pdf(x, k)", fn: (x, k) => chi2pdf(x, k), min: 2 },
	chi2cdf: { usage: "chi2cdf(x, k)", fn: (x, k) => chi2cdf(x, k), min: 2 },
	invchi2: { usage: "invchi2(q, k)", fn: (q, k) => chi2quantile(q, k), min: 2 },
};

/** The usage strings, for the tool description. */
export const DISTRIBUTION_USAGE = Object.values(DISTRIBUTIONS).map(
	(d) => d.usage,
);

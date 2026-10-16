type h = `${bigint}h`;
type m = `${bigint}m`;
type s = `${bigint}s`;
type ms = `${bigint}ms`;

type Hour = `${h}${m | ''}${s | ''}${ms | ''}`;
type Minute = `${m}${s | ''}${ms | ''}`;
type Second = `${s}${ms | ''}`;
type Milli = `${ms}`;

/**
 * Duration is a string value representing a duration in time.
 * The format is as specified in GEP-2257, a strict subset of
 * the syntax parsed by Golang time.ParseDuration.
 *
 * Pattern: `^([0-9]{1,5}(h|m|s|ms)){1,4}$`
 */
export type Duration = Hour | Minute | Second | Milli;

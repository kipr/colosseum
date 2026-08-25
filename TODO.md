- Allow marking individual teams present in queue for DS/DE
May require schema changes.

- Refactor bracket queue order for optimal event efficiency
Requires updating SQL bracket templates.
Need some more work to establish exactly what this looks like, but the general goals are:
- Minimizing scenarios where a team has to run back-to-back. Or, generally, maximizing the time between a team's runs.
- Take full advantage of parallelism at events with multiple tables. For example, matches become very serial at the end of the redemption brackets, so we probably want to interleave those with winners bracket matches as much as possible.

- Track game tables
Probably a schema update
This is more for tracking scores so that if there is an issue with a score, the head judge knows where to go.
That is, as an attribute of the score rather than the queue item.

- Indicate DQ on bracket
- Indicate "no contest" in brackets
Probably new match state in SQL and accompanying UI.
A DQ comes from rules violations is treated as a loss.
A "no contest" is used at the judge's discretion when one team obviously significantly outscored the other. It saves time by avoiding scoring the match and avoids embarassing the loser with a point gap like 1000 - 10.
- Allow marking individual teams present in queue for DS/DE
May require schema changes.

We need to refactor bracket queue order for optimal event efficiency.
The general goals are:
- Minimizing scenarios where a team has to run back-to-back. Or, generally, maximizing the time between a team's runs.
- Take full advantage of parallelism at events with multiple tables. For example, matches become very serial at the end of the redemption brackets, so we probably want to interleave those with winners bracket matches as much as possible.

Lines in the following proposed orders indicate matches that can be played in parallel

4-team bracket proposed order
1, 2
4
3
5
6
7

8 team bracket proposed order
1-4,
6, 7, 5, 8
9, 10, 13
11
12
14
15

16 team bracket proposed order
1-8
11, 12, 9, 10, 13-16
17-20,
25, 21, 26, 22
23, 24
27, 28
29
30
31

This pattern seems to minimize serial matches and give all teams a roughly equal break between matches. Do you see any better options? If so, suggest them. If not, try to extrapolate this pattern out to 32 and 64-team brackets.

- Track game tables
Probably a schema update
This is more for tracking scores so that if there is an issue with a score, the head judge knows where to go.
That is, as an attribute of the score rather than the queue item.

- Indicate DQ on bracket
- Indicate "no contest" in brackets
Probably new match state in SQL and accompanying UI.
A DQ comes from rules violations is treated as a loss.
A "no contest" is used at the judge's discretion when one team obviously significantly outscored the other. It saves time by avoiding scoring the match and avoids embarassing the loser with a point gap like 1000 - 10.
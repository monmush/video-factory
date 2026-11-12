---
name: user-flow
description: Map an operator task into a concise user flow, including decisions and recovery states. Use when clarifying journeys, task flows or screen transitions; not for visual styling or choosing infrastructure.
---

# User flow

Read the project's context and current decisions first. Work on the task the user has asked to explore; do not design the whole application by default.

- Identify the actor, trigger, desired outcome and what they already know. Treat unverified persona details as hypotheses. Distinguish the operator, content approver and maintainer only when those roles affect the flow.
- Map the normal path in user language. At each step identify the user's action, system response, state saved and next decision. Keep UI arrangement and technical architecture open unless already agreed.
- Include the relevant alternate paths: edit before approval, partial success, retry, cancel, resume after interruption and budget exhaustion. Mark which actions incur cost and what regeneration invalidates. Do not assume cancellation can undo provider charges.
- Separate direct operator work from AI or rendering wait time. Include script preparation and review when mapping the whole batch; flag any mismatch with the pilot's agreed measurement boundary.
- Return a compact flow and only the unresolved questions that change it. A short numbered sequence is enough when there are few branches; use a diagram only when it improves understanding.

Validate with a concrete walkthrough using the agreed batch size. Define observable completion and recovery outcomes. Record confirmed decisions in the project context and leave proposals clearly labelled. Do not implement screens or select a node-editor library unless requested.

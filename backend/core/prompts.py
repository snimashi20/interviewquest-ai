# this text is sent to the AI so it knows what to do - "write me a set of interview questions".
# {cv_section} is either empty (a plain role-based interview) or the CV block built below
QUESTION_GENERATION_SYSTEM_PROMPT = """You are an experienced interviewer on the hiring panel for this role.

Generate exactly {question_count} interview questions for a candidate interviewing for the
role of "{role}" at a "{difficulty}" difficulty level.

Rules:
- Ask what a real panel for THIS role would ask. For a hands-on engineering role that means
  technical depth: coding, design, debugging. For a management or leadership role (anything
  with manager, head, director, VP, chief, officer, owner or coach in the title) it means
  people, strategy, delivery, budget, risk, stakeholders and governance -
  mostly situational "tell me about a time" and "how would you handle" questions, with only
  as much technical depth as that role is really accountable for.
- Pitch the difficulty level against that role's own ladder: "Beginner" is an entry-level or
  first-time candidate for the role, "Advanced" is a seasoned one.
- Each question must stand on its own and be answerable in a few paragraphs of text.
- Do not repeat the same ground twice - spread the questions across different topics.
- Order them so the interview warms up: the easier questions first, the hardest last.
- Vary the kind of question across the set: technical knowledge, problem-solving, practical
  scenarios ("walk me through how you would...") and communication or teamwork.
- Never give away the answer inside the question, and stay professional and encouraging.
- Give every question a short topic label (e.g. "Operating Systems", "System Design",
  "REST APIs", "Stakeholder Management", "Budgeting", "Incident Management") that categorises it.
{voice_note}{cv_section}"""


# glued into the prompt above when the candidate is sitting a VOICE interview, where every
# question is read out by a speech synthesiser and answered out loud
VOICE_QUESTION_NOTE = """- This interview is spoken: each question is read aloud to the candidate and
  answered out loud. Write every question as plain spoken English - one or two sentences, no
  markdown, no code blocks, no bullet points, no emoji, and nothing that needs to be read on
  screen to make sense (no "given the snippet below").
"""


# glued into the prompt above when the student picked a CV to be interviewed on.
# this is what makes the questions "about them" instead of generic role questions
CV_QUESTION_CONTEXT = """
This candidate uploaded their CV. Base the questions on what it actually says - the
technologies they claim, the projects they describe and the responsibilities they list.
Ask the kind of follow-up a real interviewer asks when probing whether the CV is genuine:
reference a specific project or technology from it rather than asking in the abstract.
Do not ask about technologies that do not appear in the CV.

--- CV START ---
{cv_text}
--- CV END ---
"""


# ---------- practice mode ----------

# sent to the AI when the student drills one subject instead of sitting a whole interview.
# the big difference from the interview prompt is that every question comes back with its
# model answer attached, so the student can compare once they have had their own go.
PRACTICE_QUESTION_GENERATION_SYSTEM_PROMPT = """You are an experienced technical interviewer writing practice
questions for a candidate revising one specific subject.

Subject: {topic}
{focus_line}Difficulty: {difficulty}
Write exactly {question_count} questions.

{style_rules}

Rules for every question:
- Stay inside the subject above. Do not drift into neighbouring subjects.
- Ask the kind of question a real interviewer asks at this difficulty - no trivia.
- Do not cover the same ground twice. Order them easiest first.
- topic: a short label for the exact thing being tested, e.g. "Sliding window" or "Indexes".
- model_answer: the full answer a strong candidate would give. It is shown to the student
  AFTER they submit their own attempt, so it must be genuinely complete and correct -
  explain the reasoning, not just the conclusion.

{coding_rules}"""


# the "write theory questions" half of the practice prompt
PRACTICE_THEORY_RULES = """Every question must be a written question, answered in prose.
Set kind to "THEORY" for all of them, and leave language and starter_code empty."""


# the "write coding tasks" half
PRACTICE_CODING_RULES = """Every question must be a hands-on coding task.
Set kind to "CODING" for all of them."""


# when the student asked for a bit of both
PRACTICE_MIXED_RULES = """Write a mix: roughly half written questions (kind "THEORY") and half
hands-on coding tasks (kind "CODING"). Alternate between them rather than grouping them."""


# appended when the set can contain coding tasks, so what comes back is actually runnable in
# the browser workspace rather than just readable
PRACTICE_CODING_DETAIL = """Extra rules for every CODING question:
- language must be exactly "python" or "javascript". Prefer "python" unless the subject is
  clearly a JavaScript one.
- The task must be solvable in a single self-contained file, with no third-party packages and
  no file, network or input() access - it runs in a sandboxed browser runtime.
- State the input and output precisely, and include at least one worked example
  (input -> expected output) in the question text.
- starter_code: a short runnable stub in that language - the function signature with a
  docstring or comment, plus a couple of example calls printed out, so the student can press
  Run straight away and see something. Leave the actual logic unimplemented.
- model_answer: the complete working solution in the same language, ending with one line
  giving its time and space complexity."""


# grading prompt used in practice mode, where we already have a reference answer to mark against
PRACTICE_EVALUATION_SYSTEM_PROMPT = """You are an experienced technical interviewer marking a candidate's
practice answer against a reference answer.

Question:
{question_text}

Reference ("model") answer:
{model_answer}

Candidate's answer:
{answer_text}

{code_note}Mark the candidate's answer and return:
- score: an integer from 0 to 100 for how close it is to the reference answer, judging
  correctness first, then completeness, then clarity
- feedback: a short paragraph telling the candidate where they stand
- strengths: specific things they got right
- improvements: specific things the reference answer covers that theirs does not

The reference answer is one good answer, not the only one - a different but correct approach
should still score well. Do not penalise wording or formatting. Be fair and specific."""


# glued into the prompt above when the answer is code rather than prose
PRACTICE_CODE_NOTE = """The candidate's answer is {language} code, and may be followed by the output
it produced when they ran it. Judge whether the code is correct and handles the edge cases, and
say so plainly if it does not run, crashes, or fails the example given in the question.

"""


# this text is sent to the AI when it's time to grade a candidate's answer
ANSWER_EVALUATION_SYSTEM_PROMPT = """You are an experienced interviewer grading a candidate's answer.

Interview question:
{question_text}

Candidate's answer:
{answer_text}

Evaluate the answer and return:
- score: an integer from 0 to 100 reflecting correctness, completeness, and clarity
- feedback: a short paragraph summarizing the overall quality of the answer
- strengths: a list of specific things the candidate got right
- improvements: a list of specific things the candidate should improve or add

Be fair, specific, and constructive."""


# this text is sent to the AI to turn a CV into a revision checklist.
# the result feeds the "My CV" tab, which sits next to the Fundamentals tab
TOPIC_EXTRACTION_SYSTEM_PROMPT = """You are a technical interview coach reading a candidate's CV.

Your job is to build a revision checklist of the topics THIS candidate will be questioned on,
based only on what their CV actually claims.

Rules:
- Only include technologies, tools, concepts and domains that genuinely appear in the CV.
  Never add something just because it is popular. If the CV does not mention Kubernetes,
  Kubernetes must not appear.
- Be specific rather than naming the bare technology. Prefer "React re-renders and the
  dependency array" over just "React" - the student needs to know what to actually revise.
- Group the topics into 3 to 7 categories that describe how the CV reads, for example
  "Frontend", "Backend & APIs", "Cloud & DevOps", "Databases", "Languages", "Testing",
  or a domain area taken from their projects.
- Give each category a short blurb saying why it is on the list, mentioning the evidence
  from the CV (e.g. "You list React and Next.js on two projects").
- Put 3 to 8 topics in each category.
- Give every topic a level saying how deeply an interviewer would probe it given how the CV
  presents it: "Beginner" if it is listed in passing, "Intermediate" if it was used on a real
  project, "Advanced" if they claim ownership, scale or years of it.
- Across the whole checklist, return at most 40 topics.

--- CV START ---
{cv_text}
--- CV END ---
"""


# ---------- the adaptive (conversational) interview ----------

# used by an ADAPTIVE interview, which writes one question at a time instead of the whole
# set up front. this is what makes the interview feel like a conversation rather than a
# questionnaire: the AI sees what the candidate just said and can follow up on it.
# the history block is deliberately a short summary, not the full transcript - see
# ai_service.build_interview_context()
NEXT_QUESTION_SYSTEM_PROMPT = """You are an experienced software engineering interviewer running a live
interview. You ask one question at a time and listen to the answer before deciding what to ask next.

Role being interviewed for: "{role}"
Difficulty level: "{difficulty}"
This is question {question_number} of {question_count}.

{history_section}
Write the single next question to ask.

Rules:
- Ask exactly one question. It must be answerable out loud in a minute or two.
- Ask what a real panel for THIS role would ask. For a hands-on engineering role that means
  technical depth: coding, design, debugging. For a management or leadership role (anything
  with manager, head, director, VP, chief, officer, owner or coach in the title) it means
  people, strategy, delivery, budget, risk, stakeholders and governance.
- Pitch the difficulty against that role's own ladder: "Beginner" is an entry-level candidate
  for the role, "Advanced" is a seasoned one.
- If the last answer left something worth probing - a claim to test, a trade-off they skipped,
  a technology they named - ask a follow-up about it and set is_followup to true. Otherwise
  move to new ground and set is_followup to false. Do not follow up more than twice in a row.
- Never re-ask a question already listed as asked, and do not revisit a topic already covered
  unless you are deliberately following up on the last answer.
- Across the whole interview, vary the kind of question: technical knowledge, problem-solving,
  practical scenarios ("walk me through how you would..."), and communication or teamwork.
- Never give away the answer, correct the candidate, or grade them in the question text.
  Do not comment on how the last answer went. Just ask the next question.
- Stay professional and encouraging. No preamble, no "great answer", no numbering -
  return only the question itself.
- The question is read aloud by a speech synthesiser, so write it as plain spoken English:
  one or two sentences, no markdown, no code blocks, no bullet points, no emoji.
- Give the question a short topic label (e.g. "System Design", "Incident Management").
"""


# the first question of an adaptive interview has no history to work from
NEXT_QUESTION_OPENING = """This is the opening question, so there is no history yet. Start the
interview where a real interviewer starts: something the candidate can settle into and answer
from their own experience, pitched at the level above.
"""


# glued in once at least one question has been asked. built from a summary rather than the
# whole transcript so a 15-question interview doesn't grow the prompt 15 times over
NEXT_QUESTION_HISTORY = """Questions already asked (do not repeat these):
{asked_list}

Topics already covered: {covered_topics}

The most recent exchange:
{recent_exchange}
"""

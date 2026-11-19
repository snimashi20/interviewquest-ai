// one place for the positions and levels used across the app, so the interview form and the
// Fundamentals checklist always offer exactly the same options.

// every position the app supports, grouped the way a job board groups them. the group is only
// for the dropdown's headings - the role string itself is what gets sent to the backend and
// stored on the interview, so these labels must stay stable once interviews exist with them.
export const ROLE_GROUPS = [
  {
    id: 'engineering',
    label: 'Engineering & Development',
    roles: [
      'Software Engineering',
      'Backend Developer',
      'Frontend Developer',
      'Full Stack Developer',
      'Data Engineer',
      'DevOps Engineer',
      'Mobile Developer',
    ],
  },
  {
    id: 'executive',
    label: 'Executive & Senior Leadership',
    roles: [
      'Chief Information Officer (CIO)',
      'Chief Technology Officer (CTO)',
      'Chief Information Security Officer (CISO)',
      'Chief Data Officer (CDO)',
      'Chief Digital Officer',
      'Chief Product Officer (CPO)',
      'VP of Engineering',
      'VP of Information Technology',
      'VP of Product',
      'Head of Technology',
      'Head of IT',
      'Director of Information Technology',
      'Director of Engineering',
      'Director of Product Management',
      'Director of Information Security',
    ],
  },
  {
    id: 'tech-management',
    label: 'Engineering & Technical Management',
    roles: [
      'Engineering Manager',
      'Software Development Manager',
      'Technical Lead',
      'Enterprise Architect',
      'Solutions Architect',
      'DevOps Manager',
      'Site Reliability (SRE) Manager',
      'QA / Test Engineering Manager',
      'Cloud Engineering Manager',
      'Data Engineering Manager',
      'Analytics Manager',
      'AI / ML Engineering Manager',
    ],
  },
  {
    id: 'it-operations',
    label: 'IT Operations & Infrastructure Management',
    roles: [
      'IT Manager',
      'IT Operations Manager',
      'IT Service Delivery Manager',
      'IT Infrastructure Manager',
      'IT Support / Help Desk Manager',
      'Network Manager',
      'Systems Administration Manager',
      'Database Administration Manager',
      'Enterprise Applications / ERP Manager',
      'IT Asset Manager',
    ],
  },
  {
    id: 'delivery',
    label: 'Project, Program & Product Management',
    roles: [
      'IT Project Manager',
      'Technical Project Manager',
      'Program Manager',
      'Portfolio Manager',
      'Product Manager',
      'Product Owner',
      'Delivery Manager',
      'Scrum Master',
      'Agile Coach',
      'Release Manager',
      'Change Management Lead',
    ],
  },
  {
    id: 'governance',
    label: 'Business Systems, Security & Governance',
    roles: [
      'Information Security Manager',
      'Governance, Risk & Compliance (GRC) Manager',
      'Security Operations (SOC) Manager',
      'Data Governance Manager',
      'Business Systems Analyst',
      'IT Business Partner',
      'Vendor / Procurement Manager',
      'IT Auditor',
      'Disaster Recovery / BCP Manager',
    ],
  },
]

// flat list of every role, for anything that just needs to know whether a role is valid
export const ROLES = ROLE_GROUPS.flatMap((group) => group.roles)

// what a fresh interview form and the Fundamentals page start on
export const DEFAULT_ROLE = 'Software Engineering'

// the three depths a topic can be asked at
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced']

// plain-english hint for what each level maps to in a real hiring process.
// hands-on positions and management positions ladder differently, so they get their own wording.
export const ENGINEERING_LEVEL_HINTS = {
  Beginner: 'internship / junior screens',
  Intermediate: 'mid-level engineer',
  Advanced: 'senior engineer / tech lead',
}

export const MANAGEMENT_LEVEL_HINTS = {
  Beginner: 'first-time lead / aspiring manager',
  Intermediate: 'established manager owning a team or service',
  Advanced: 'senior leader / director & above',
}

// how many questions a PRACTICE set can be. practice is a short drill, so it stays short
export const QUESTION_COUNTS = [3, 5, 8]
export const DEFAULT_QUESTION_COUNT = 5

// a mock interview is a longer sitting: 10 questions is a realistic screen, and the backend
// accepts anything up to 15
export const INTERVIEW_QUESTION_COUNTS = [5, 10, 15]
export const DEFAULT_INTERVIEW_QUESTION_COUNT = 10

// how the candidate answers. TEXT is the original typed interview; VOICE reads every question
// aloud and takes a spoken answer, transcribed on the backend
export const INTERVIEW_TYPES = [
  {
    id: 'TEXT',
    label: 'Text interview',
    blurb: 'Read each question and type your answer, at your own pace.',
  },
  {
    id: 'VOICE',
    label: 'Voice interview',
    blurb:
      'Your interviewer reads each question out loud and you answer by speaking. Needs a microphone, and follows up on what you say.',
  },
]

// the file types the backend can read a CV out of, used for the file picker's accept list
export const CV_ACCEPT = '.pdf,.docx,.txt,.md'

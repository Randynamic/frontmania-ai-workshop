/**
 * Words that start with a capital in a CV but identify nobody: section
 * headings, job titles, technology names, calendar words and the common
 * words that open a sentence or a bullet. identity-hints.ts treats every
 * other capitalised word of a registered text as a possible name or
 * employer, so this list decides what the masker and the echo scrub leave
 * readable. Missing a word here over-masks it (a marker where "Svelte"
 * was); it never lets a name through. Lowercase, compared case-insensitively.
 */

const CV_WORDS = `
  curriculum vitae resume résumé cv profile summary about contact details personal
  experience work employment history career education skills skill interests interest
  avoid languages language projects project certifications certificates publications
  talks references hobbies volunteering awards courses training present current today
  email phone mobile address linkedin github website portfolio location nationality
  born birth date remote hybrid onsite freelance contract internship intern
`;

const ROLE_WORDS = `
  senior junior medior lead principal staff chief head director manager management
  engineer engineering developer development architect architecture designer design
  consultant specialist analyst owner product programme program officer team teams
  frontend front-end front end backend back-end back fullstack full-stack full stack
  software web mobile platform tech technical technology cto ceo cio vp founder
  co-founder student graduate trainee assistant associate coordinator coach mentor
  researcher scientist tester qa devops sre ux ui ux/ui interaction human-computer
  human computer science msc bsc ba ma phd degree university universiteit hogeschool
  college school academy bootcamp digital studio agency labs group solutions services
  systems company startup scale-up consultancy government public sector retail
  b.v bv n.v nv gmbh ltd inc llc hbo mbo wo informatica computer-science
`;

const TECH_WORDS = `
  javascript typescript js ts node node.js nodejs deno bun react react.js next next.js
  nextjs vue vue.js nuxt nuxt.js angular angularjs svelte sveltekit solid solidjs qwik
  astro remix ember jquery backbone preact lit stencil htmx alpine alpine.js redux
  zustand mobx rxjs ngrx graphql apollo relay trpc rest restful grpc api apis sdk
  html html5 css css3 sass scss less tailwind tailwindcss bootstrap radix shadcn mui
  chakra storybook chromatic figma sketch zod yup prisma drizzle typeorm sequelize
  postgres postgresql mysql sqlite mongodb mongo redis elasticsearch kafka rabbitmq
  sql nosql supabase firebase vercel netlify cloudflare aws azure gcp google cloud
  docker kubernetes k8s terraform pulumi ansible linux unix macos windows ios android
  git github gitlab bitbucket actions ci cd ci/cd jenkins circleci turborepo nx lerna
  pnpm npm yarn webpack vite rollup esbuild swc babel parcel turbopack jest vitest
  mocha cypress playwright puppeteer selenium testing library eslint prettier biome
  wcag aria a11y i18n seo pwa spa ssr ssg isr rsc edge serverless microservices
  microfrontends micro-frontends monorepo agile scrum kanban safe jira confluence
  notion slack openai anthropic claude gpt chatgpt copilot cursor llm llms ai ml
  mastra langchain langgraph llamaindex mlflow gepa dspy rag mcp otel opentelemetry
  sentry datadog grafana prometheus lighthouse web3 blockchain python java kotlin
  swift rust go golang php laravel symfony ruby rails c c# c++ .net dotnet scala
  elixir phoenix dart flutter electron tauri webassembly wasm three.js d3 d3.js
  canvas webgl webrtc websockets http https json xml yaml markdown regex oauth jwt
  saml sso gdpr avg iso scorm wordpress drupal fastify express nestjs hono koa openapi
  swagger openid connect nvda voiceover talkback jaws timescaledb tanstack query
  server client components component hooks signals dora slo sli rfc bff bffs dom
  vercel ai sdk e2e tdd bdd oop
`;

const TOPIC_WORDS = `
  accessibility performance security privacy observability tracing evaluation evals
  testing quality reliability scalability usability research strategy operations
  business information communication communications multimedia media marketing sales
  finance payments payment energy logistics insurance banking healthcare education
  e-commerce ecommerce commerce travel booking flow checkout search content community
  conference meetup speaker sponsor vendor panel keynote workshop deep dive dives
  system systems data analytics infrastructure integration integrations automation
  agents agent agentic tools tool tooling patterns pattern migration modernisation
  modernization certified certification professional frontmania gemeente bureau
  reads read open source open-source application applications app apps
`;

const COMMON_WORDS = `
  a an the and or but nor so yet for of in on at to from by with without into onto
  about above after before during under over between through across per via vs
  i me my we our us you your he she his her it its they them their this that these
  those who what which where when why how all any both each every few more most many
  much some such no not only own same than too very also just now then there here
  is am are was were be been being have has had do does did can could will would
  shall should may might must let
  one two three four five six seven eight nine ten eleven twelve thirteen fourteen
  fifteen twenty thirty forty fifty hundred first second third last next new
  january february march april may june july august september october november
  december feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday
  thursday friday saturday sunday spring summer autumn fall winter
  led lead leading built build building ran run running own owned wrote write
  writing grew grow taught teach teaching won win set helped help moved move made
  make shipped ship designed introduced delivered developed created created managed
  mentored coached migrated rebuilt maintained improved reduced increased launched
  implemented architected piloted organised organized started joined worked working
  responsible currently previously since until today also including
  key main core large small big high low full part time year years month months
  north south east west netherlands nederland the-netherlands europe eu nl
  dutch english german french spanish turkish arabic polish italian portuguese native fluent
  yes okay ok etc e.g i.e fictional example sample
`;

/** Dutch, German and French name particles: part of a name phrase, never a hint alone. */
export const NAME_PARTICLES: ReadonlySet<string> = new Set([
  'van',
  'de',
  'der',
  'den',
  'het',
  "'t",
  'ten',
  'ter',
  'te',
  'von',
  'zu',
  'di',
  'da',
  'du',
  'le',
  'la',
  'del',
  'dos',
  'op',
]);

const words = (block: string): readonly string[] => block.split(/\s+/).filter(Boolean);

export const COMMON_TERMS: ReadonlySet<string> = new Set([
  ...words(CV_WORDS),
  ...words(ROLE_WORDS),
  ...words(TECH_WORDS),
  ...words(TOPIC_WORDS),
  ...words(COMMON_WORDS),
  ...NAME_PARTICLES,
]);

/** True when a capitalised word is a known heading, title, technology or common word. */
export const isCommonTerm = (word: string): boolean => COMMON_TERMS.has(word.toLowerCase());

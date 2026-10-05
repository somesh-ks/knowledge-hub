# News Outlet: Sources Reference

> Supplementary sources not part of the automated daily digest pipeline. These require separate tooling (video/audio), social API access, or are periodic references. Kept here for manual monitoring, future pipeline expansion, and to avoid re-evaluating rejected candidates.
>
> Active pipeline sources: [Sources.md](../../config/sources.md)

---

## 1. YouTube Channels

### Design Engineering / Frontend
| Channel | URL | Focus |
|---------|-----|-------|
| Fireship | https://www.youtube.com/@Fireship | 100-second explainers, weekly tech news |
| Kevin Powell | https://www.youtube.com/@KevinPowell | CSS mastery, responsive design |
| Theo (t3.gg) | https://www.youtube.com/@t3dotgg | TypeScript, architectural opinions, AI tooling |
| Web Dev Simplified | https://www.youtube.com/@WebDevSimplified | JS/React concept explainers |
| The Coding Train | https://www.youtube.com/@TheCodingTrain | Creative coding, p5.js, generative art |
| Hyperplexed | https://www.youtube.com/@Hyperplexed | CSS/JS visual effects, recreating viral UI |

### AI / ML
| Channel | URL | Focus |
|---------|-----|-------|
| Two Minute Papers | https://www.youtube.com/@TwoMinutePapers | Research paper visual summaries |
| Yannic Kilcher | https://www.youtube.com/@YannicKilcher | Deep ML paper reviews |
| 3Blue1Brown | https://www.youtube.com/@3blue1brown | Math/ML visualizations |
| AI Explained | https://www.youtube.com/@AiExplained-official | Model capability analysis |
| Matt Wolfe | https://www.youtube.com/@maboroshi | AI tools, weekly AI news roundup |
| Wes Roth | https://www.youtube.com/@WesRoth | AI industry commentary |

### Tech Industry / Products
| Channel | URL | Focus |
|---------|-----|-------|
| MKBHD | https://www.youtube.com/@mkbhd | Tech product reviews, design critique |
| Linus Tech Tips | https://www.youtube.com/@LinusTechTips | Hardware, consumer tech |
| Y Combinator | https://www.youtube.com/@ycombinator | Startup advice, founder interviews |

---

## 2. X.com / Twitter Accounts to Monitor

### Design Engineers
| Handle | Why |
|--------|-----|
| @rauno_rocks (Rauno) | Interaction design craft posts |
| @emilkowalski_ | Animation and motion tips |
| @JoshWComeau | CSS and React deep dives |
| @shadcn | Component library updates |
| @devongovett | React Aria, Parcel, Adobe design tools |
| @adamwathan | Tailwind CSS updates |
| @jh3yy (Jhey) | CSS experiments |
| @SaraSoueidan | Accessibility, inclusive design |
| @argaborink (Adam Argyle) | Chrome CSS DevRel |
| @Una (Una Kravets) | Chrome DevRel, CSS features |

### AI / Tech
| Handle | Why |
|--------|-----|
| @sama (Sam Altman) | OpenAI CEO |
| @AnthropicAI | Anthropic official |
| @GoogleDeepMind | DeepMind official |
| @karpathy (Andrej Karpathy) | AI education, practical LLM insights |
| @simonw | Simon Willison; LLM tooling |
| @swyx | AI engineering, Latent Space podcast |
| @skirano (Pietro Schirano) | AI + design, creative AI tools |
| @levelsio | Indie maker, AI products |

---

## 3. Podcasts

| Podcast | URL | Focus |
|---------|-----|-------|
| Latent Space | https://www.latent.space | AI engineering (swyx + Alessio) |
| Syntax.fm | https://syntax.fm | Web dev, design, tooling (Wes Bos + Scott Tolinski) |
| ShopTalk Show | https://shoptalkshow.com | Frontend, CSS, web standards |
| The Changelog | https://changelog.com/podcast | Open source, developer culture |
| Lenny's Podcast | https://www.lennyspodcast.com | Product management, growth |
| Acquired | https://www.acquired.fm | Tech company deep dives |
| Lex Fridman Podcast | https://lexfridman.com/podcast | AI researchers, tech leaders |

---

## 4. Lower-Priority Aggregators

Useful for discovery but lower signal-to-noise ratio compared to core pipeline aggregators.

| Source | URL | Cadence | Signal |
|--------|-----|---------|--------|
| Indie Hackers | https://www.indiehackers.com | Daily | Solo/small-team product builders |
| DevHunt | https://devhunt.org | Daily | Developer tool launches (HN-style) |
| Peerlist Launchpad | https://peerlist.io/launchpad | Real-time | Community launches for design engineers & makers |
| ScrollLaunch | https://scrolllaunch.com | Weekly | Curated indie developer tool launches |

---

## 5. Academic Conferences, Bridge Publications & Research Labs

Annual/periodic venues and institutional research hubs. High quality but not suited for daily automated scraping; relevant for proceedings tracking and periodic deep dives.

> [!NOTE]
> Open Access journals (ACM TOCHI, PACMHCI) and daily preprint feeds (arXiv cs.HC, ACM DL RSS) remain in the active pipeline: [Sources.md §9](../../config/sources.md).

### Flagship Archival Conferences (The Core Engineering & UX Venues)

In Human-Computer Interaction and Interaction Design, top-tier peer-reviewed archival conferences (e.g., CHI, UIST) carry equal or greater prestige and citation impact compared to traditional journals. As of 2026, the ACM Digital Library has completed its transition to open access (ACM Open), making direct paper scraping and PDF retrieval barrier-free without hitting paywalls.

| Conference | URL / Proceedings | Signal for Design Engineers & UX | Timing |
|------------|-------------------|----------------------------------|--------|
| **ACM UIST** (User Interface Software & Technology) | https://uist.acm.org | The highest-craft venue for design engineers: input hardware, UI software frameworks, gesture engines, dynamic layout systems, physics UI, and agent toolkits. | Annual (October) |
| **ACM CHI** (Human Factors in Computing Systems) | https://chi.acm.org | The flagship global conference in HCI. Premier venue for novel interaction techniques, AI-human collaboration, quantitative usability, and empirical user studies. | Annual (April/May) |
| **ACM DIS** (Designing Interactive Systems) | https://dis.acm.org | Centers the craft and philosophy of interaction design: tangible prototypes, critical design, aesthetics, and reflective UX practice. | Annual (July) |
| **ACM CSCW** (Computer Supported Cooperative Work) | https://cscw.acm.org | Multiplayer canvas architectures, async collaborative editing, shared mental models, and group communication infrastructure. | Annual (November) |
| **ACM IUI** (Intelligent User Interfaces) | https://iui.acm.org | The exact intersection of ML and UX: adaptive interfaces, human-in-the-loop systems, explainable AI (XAI), and prompt-driven UI generation. | Annual (March/April) |
| **ACM TEI** (Tangible, Embedded and Embodied Interaction) | https://tei.acm.org | Physical computing, spatial audio, haptic feedback mechanisms, and post-screen interaction design. | Annual (February/March) |
| **ACM C&C** (Creativity and Cognition) | https://cc.acm.org | Computational co-creativity, digital studio tools, generative design software, and artistic interface workflows. | Annual (June) |

### Academic-Practitioner Bridge Publications (Open & Free)
| Publication | URL | Cadence | Value & Focus |
|-------------|-----|---------|---------------|
| **ACM interactions Magazine** | https://interactions.acm.org | Bimonthly | Flagship bimonthly publication by SIGCHI bridging research and industry craft. High visual production, design essays, interface critiques, and emerging paradigms without academic jargon. |
| **Journal of Usability Studies (JUS)** | https://uxpajournal.org | Quarterly | Double-blind peer-reviewed open-access journal by UXPA. Focused on empirical bench testing, standardized metrics (SUS, UMUX-LITE, SEQ), and practitioner methodology. |

### Frontier Empirical Labs & Industrial HCI Groups (Free Research Hubs)
| Lab / Research Organization | URL | Focus & Practical Utility |
|-----------------------------|-----|---------------------------|
| **Nielsen Norman Group (NN/g) Research** | https://www.nngroup.com/articles/ | The industry gold standard for quantitative usability benchmarks, eye-tracking patterns, user testing methodology, and design heuristics. |
| **Google People + AI Research (PAIR)** | https://pair.withgoogle.com | Foundational PAIR Guidebook, empirical research papers on human-AI trust, interpretability, and interaction patterns for generative AI. |
| **Microsoft Research (HCI & Epic)** | https://www.microsoft.com/en-us/research/research-area/human-computer-interaction/ | Authors of the 18 Guidelines for Human-AI Interaction; leading research on canvas interfaces, agentic UX, and developer ergonomics. |
| **MIT Media Lab (Tangible Media & Fluid Interfaces)** | https://www.media.mit.edu/research/ | Radical interaction prototypes, seamless digital-physical interfaces, wearable memory augmentation, and spatial computing. |
| **Stanford HCI Group** | https://hci.stanford.edu/publications/ | Groundbreaking research in generative agent simulations, computational interaction design, and social computing platforms. |
| **CMU Human-Computer Interaction Institute (HCII)** | https://hcii.cmu.edu/research/publications | World's premier dedicated HCI research department; continuous high-volume contributions to UIST, CHI, and assistive tech. |

---

## 6. Sources Already Known

- [x] Better Stack
- [x] Fireship
- [x] Friday Checkout
- [x] OpenAI Blog
- [x] Anthropic Blog
- [x] Google DeepMind Blog

---

## 7. Evaluated & Rejected Sources (2026-10-05)

Sources reviewed and scored with TypeSafe Jev. None met the inclusion threshold for the active pipeline.

### Already Tracked (Duplicates)
| Source | URL | Why Skipped |
|--------|-----|-------------|
| Brutalist Report | https://brutalist.report/ | Already listed under §5 Aggregators |
| Hacker News | https://news.ycombinator.com/ | Already tracked via Firebase API, Algolia API, and Composio (3 methods) |
| The Verge | https://www.theverge.com/subscribe | Subscribe lander, not a feed. The Verge already tracked under §5 Tech Journalism |

### Not a Source
| Source | URL | Why Skipped |
|--------|-----|-------------|
| Perplexity Search | https://www.perplexity.ai/search/... | One-time search query result page, not a scrapable recurring feed |

### Marginal Interest
| Source | URL | Score | Notes |
|--------|-----|-------|-------|
| News Minimalist | https://www.newsminimalist.com/ | 1.04/3 | Gemini significance scoring is interesting methodology for the digest's own ranking. As a source, too broad and general. |
| GreyCoder List | https://greycoder.com/a-list-of-text-only-new-sites/ | 1.31/3 | Meta-directory of minimalist news sites. One-time reference, not a recurring feed. |
| ScienceDaily | https://www.sciencedaily.com/ | 1.00/3 | Biology/medicine/space press releases. Wrong domain; project already tracks arXiv cs.HC and HCI venues. |
| Kagi News | https://news.kagi.com/world/latest | 0.62/3 | Auth-gated (Kagi account required). Technology section decent but no unique coverage. |

### Rejected (Noise / Wrong Vertical)
| Source | URL | Score | Notes |
|--------|-----|-------|-------|
| Skimfeed Tech | https://skimfeed.com/tech.html | 0.20/3 | Housing markets, Prime Day deals, financial advice mixed with tech. Sources already tracked. |
| Skimfeed Design | https://skimfeed.com/design.html | 0.78/3 | Architecture, fashion, furniture design. Wrong vertical; project targets UI/UX/frontend. |

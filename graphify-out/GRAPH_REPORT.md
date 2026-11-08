# Graph Report - artifact-gallery  (2026-11-08)

## Corpus Check
- 39 files · ~58,198 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 6, .woff2 3, .css 2)

## Summary
- 1053 nodes · 2079 edges · 98 communities (53 shown, 45 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `af6ac76e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- panel.ts
- service/main.js
- cache.ts
- ct
- steps
- Ae
- steps
- htmlRender.ts
- ref_node_path
- host-screenshots.ts
- library.ts
- hr
- color.ts
- steps
- steps
- artifacts.ts
- Library
- v
- Landing.vue
- screenshots.ts
- Yt
- nn
- check
- ve
- Oe
- previewFrameHost.ts
- package.ts
- package.json
- re
- contributes
- rn
- preview.ts
- Lt
- vitepress
- scripts
- nullish
- zh
- Jo
- panel
- and
- or
- qe
- ProjectIcons
- buildHtmlRenderDocument
- $d
- Nd
- wh
- hs
- me
- safeParse
- pageAnchor
- pc
- al
- Be
- tl
- base64url
- Fo
- Oh
- cl
- Ka
- om
- cidrv4
- default
- el
- bl
- emoji
- cidrv6
- Ff
- fu
- gt
- rl
- datetime
- cs
- pl
- email
- ol
- jwt
- wu
- Ku
- Df
- dl
- prefault
- endsWith
- fl
- Lf
- lowercase
- nl
- O
- $o
- os
- qt
- time
- Tu
- ul
- xs
- it
- un

## God Nodes (most connected - your core abstractions)
1. `check()` - 60 edges
2. `v()` - 48 edges
3. `t()` - 33 edges
4. `Library` - 30 edges
5. `ve` - 23 edges
6. `renderContent()` - 23 edges
7. `hr()` - 18 edges
8. `renderChrome()` - 15 edges
9. `openDetail()` - 15 edges
10. `Ae()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Jt()` --indirect_call--> `vt()`  [INFERRED]
  panel/main.js → service/main.js
- `$o()` --indirect_call--> `t()`  [INFERRED]
  panel/main.js → src/locale.ts
- `wu()` --indirect_call--> `t()`  [INFERRED]
  panel/main.js → src/locale.ts
- `nl()` --indirect_call--> `t()`  [INFERRED]
  panel/main.js → src/locale.ts
- `ol()` --indirect_call--> `t()`  [INFERRED]
  panel/main.js → src/locale.ts

## Import Cycles
- None detected.

## Communities (98 total, 45 thin omitted)

### Community 0 - "panel.ts"
Cohesion: 0.05
Nodes (101): ln(), english, Language, locale, setLocale(), t(), actions, active (+93 more)

### Community 1 - "service/main.js"
Cohesion: 0.15
Nodes (18): ae(), bt(), Dt(), $e(), ft(), ge(), gs(), ie() (+10 more)

### Community 2 - "cache.ts"
Cohesion: 0.06
Nodes (47): Artifact, boundedSnapshot(), CACHE_BYTES, CachedSession, cachePrefix, CacheRequest, CHUNK_BYTES, chunksFor() (+39 more)

### Community 4 - "ct"
Cohesion: 0.11
Nodes (18): bp(), ct(), ds(), fs(), gp(), ls(), mp(), ms() (+10 more)

### Community 5 - "steps"
Cohesion: 0.05
Nodes (40): HOST_VERSION, name, runs-on, steps, strategy, timeout-minutes, track, version (+32 more)

### Community 6 - "Ae"
Cohesion: 0.12
Nodes (33): Ae(), Af(), _c(), catchall(), Cf(), clone(), describe(), Ec() (+25 more)

### Community 7 - "steps"
Cohesion: 0.07
Nodes (27): concurrency, cancel-in-progress, group, environment, runs-on, steps, name, url (+19 more)

### Community 8 - "htmlRender.ts"
Cohesion: 0.08
Nodes (14): CHART_SERIES, frameMessageSchema, HTML_RENDER_MIN_HEIGHT, HtmlRenderAnswerState, HtmlRenderFrameMessage, HtmlRenderKeyChord, HtmlRenderMark, HtmlRenderMetrics (+6 more)

### Community 9 - "ref_node_path"
Cohesion: 0.09
Nodes (16): found, pids, folder, host, hostManifest, manifest, digest, entries (+8 more)

### Community 10 - "host-screenshots.ts"
Cohesion: 0.09
Nodes (18): demos, draft, guest, hostRequire, items, library, location, model (+10 more)

### Community 11 - "library.ts"
Cohesion: 0.12
Nodes (20): DiscoveredFile, localReader(), own, Project, ReadApi, Row, scanExtensions, Session (+12 more)

### Community 12 - "hr"
Cohesion: 0.08
Nodes (42): ai(), Ap(), bg(), ci(), dg(), Dn(), ef(), fg() (+34 more)

### Community 13 - "color.ts"
Cohesion: 0.24
Nodes (18): chromaticDistance(), Color, colorHue(), contrastRatio(), fromOklab(), hexColor(), luminance(), mixColor() (+10 more)

### Community 14 - "steps"
Cohesion: 0.10
Nodes (19): runs-on, steps, timeout-minutes, GALLERY_TEST_OUTPUT, jobs, check, name, on (+11 more)

### Community 15 - "steps"
Cohesion: 0.11
Nodes (18): GH_TOKEN, jobs, release, name, on, push, permissions, contents (+10 more)

### Community 16 - "artifacts.ts"
Cohesion: 0.20
Nodes (14): documentExtensions, extractArtifacts(), imageExtensions, localImagePattern, object(), pageContent(), pageTitle(), pathFromSource() (+6 more)

### Community 17 - "Library"
Cohesion: 0.13
Nodes (7): imageSources(), GalleryError, Library, normalized(), readChatRoots(), walkArtifacts(), within()

### Community 18 - "v"
Cohesion: 0.11
Nodes (19): an(), as(), base64(), Ce(), dd(), Eh(), gl(), hm() (+11 more)

### Community 19 - "Landing.vue"
Cohesion: 0.12
Nodes (8): copied, copyFailed, french, images, { lang }, prefix, selected, text

### Community 20 - "screenshots.ts"
Cohesion: 0.12
Nodes (13): @openchamber/sdk@2.5.2, @openchamber/sdk, artifacts, library, root, server, theme, demos (+5 more)

### Community 21 - "Yt"
Cohesion: 0.15
Nodes (14): cp(), dp(), fn(), Hd(), Jh(), mn(), $n(), Nt() (+6 more)

### Community 22 - "nn"
Cohesion: 0.17
Nodes (12): je(), lt(), negative(), nn(), ug(), ke(), Mt(), Ne() (+4 more)

### Community 23 - "check"
Cohesion: 0.14
Nodes (17): check(), date(), duration(), gte(), guid(), is(), min(), multipleOf() (+9 more)

### Community 24 - "ve"
Cohesion: 0.13
Nodes (6): ct(), p, rt(), ve, ws(), ys()

### Community 25 - "Oe"
Cohesion: 0.25
Nodes (9): Cm(), Ga(), He(), La(), ns(), Oe(), pn(), Vt() (+1 more)

### Community 26 - "previewFrameHost.ts"
Cohesion: 0.15
Nodes (6): BridgeResult, bridgeResultSchema, Edges, Pending, PREVIEW_BRIDGE_CHANNEL, PreviewFrameHost

### Community 27 - "package.ts"
Cohesion: 0.17
Nodes (8): fontCss, archive, files, guides, manifest, screenshots, source, tar

### Community 28 - "package.json"
Cohesion: 0.18
Nodes (11): devDependencies, @opencode/client@2.2.0, vitepress@1.6.4, license, name, patchedDependencies, @openchamber/sdk@2.5.2, private (+3 more)

### Community 29 - "re"
Cohesion: 0.23
Nodes (13): Ac(), h(), a(), f(), s(), Mf(), Pf(), re() (+5 more)

### Community 30 - "contributes"
Cohesion: 0.18
Nodes (11): capabilities, page, service, openchamber, openchamber, apiVersion, contributes, engines (+3 more)

### Community 31 - "rn"
Cohesion: 0.20
Nodes (9): attach(), Bu(), guard(), Hu, lm(), pm(), rn(), ts() (+1 more)

### Community 32 - "preview.ts"
Cohesion: 0.29
Nodes (9): iframe(), fontCss, previewDocument(), previewThemeMessage(), themeFor(), darkLift(), HtmlRenderTheme, htmlRenderTheme() (+1 more)

### Community 33 - "Lt"
Cohesion: 0.24
Nodes (15): lg(), D(), G(), H(), J(), je(), Lt(), qt() (+7 more)

### Community 34 - "vitepress"
Cohesion: 0.29
Nodes (3): en, fr, vitepress

### Community 35 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, deploy, docs:build, package, test

### Community 36 - "nullish"
Cohesion: 0.40
Nodes (5): nullable(), nullish(), optional(), Pd(), zd()

### Community 37 - "zh"
Cohesion: 0.22
Nodes (9): array(), at(), Ch(), fh(), kl(), ks(), nh(), xt() (+1 more)

### Community 39 - "panel"
Cohesion: 0.40
Nodes (5): panel, entry, icon, id, name

### Community 41 - "or"
Cohesion: 0.40
Nodes (5): cn(), lte(), max(), nonpositive(), or()

### Community 42 - "qe"
Cohesion: 0.40
Nodes (6): Gr(), Jf(), qe(), spa(), "~standard"(), Wo()

### Community 44 - "buildHtmlRenderDocument"
Cohesion: 0.40
Nodes (5): blankNonMarkup(), buildHtmlRenderDocument(), sanitizeCssValue(), scriptJson(), themeCss()

### Community 45 - "$d"
Cohesion: 0.50
Nodes (4): $d(), int(), safe(), wl()

### Community 46 - "Nd"
Cohesion: 0.50
Nodes (4): gh(), Nd(), pipe(), transform()

### Community 47 - "wh"
Cohesion: 0.67
Nodes (3): catch(), Rc(), wh()

### Community 48 - "hs"
Cohesion: 0.43
Nodes (7): bs(), _e(), gm(), hs(), ir(), Pe(), Y()

### Community 49 - "me"
Cohesion: 0.38
Nodes (7): At(), Fe(), he(), K(), me(), Ot(), W()

### Community 50 - "safeParse"
Cohesion: 0.67
Nodes (3): isNullable(), isOptional(), safeParse()

### Community 51 - "pageAnchor"
Cohesion: 0.67
Nodes (3): htmlRenderMarksMessage(), htmlRenderRevealMessage(), pageAnchor()

### Community 57 - "Fo"
Cohesion: 0.67
Nodes (3): fa(), Fo(), ma()

### Community 60 - "Ka"
Cohesion: 0.67
Nodes (3): Ka(), tm(), uu()

### Community 61 - "om"
Cohesion: 0.67
Nodes (3): Lo(), Mr(), om()

### Community 70 - "gt"
Cohesion: 0.29
Nodes (7): gt(), Ko(), on(), Po(), positive(), $t(), Ua()

### Community 78 - "wu"
Cohesion: 0.50
Nodes (4): it(), Na(), Wr(), wu()

## Knowledge Gaps
- **45 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `t()` connect `panel.ts` to `or`, `pl`, `ol`, `wu`, `v`, `nn`, `nl`, `$o`?**
  _High betweenness centrality (0.217) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `t()` (e.g. with `ll()` and `ln()`) actually correct?**
  _`t()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Should `panel.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05153099327856609 - nodes in this community are weakly interconnected._
- **Why does `@openchamber/sdk` connect `screenshots.ts` to `panel.ts`, `preview.ts`, `cache.ts`, `ref_node_path`, `artifacts.ts`, `package.ts`, `package.json`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Should `cache.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.058173076923076925 - nodes in this community are weakly interconnected._
- **Why does `Ve()` connect `Lt` to `service/main.js`, `panel/main.js`, `hr`, `me`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Should `panel/main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.038461538461538464 - nodes in this community are weakly interconnected._
# Speech recognition eval, round 2: public

Date: 2026-11-26
Clips: 150 Hungarian (30 min), 150 English (25 min), FLEURS test split, distinct sentences, evenly spread over the split, one speaker each
Eval container: 12th Gen Intel(R) Core(TM) i7-12700H, 20 logical cores visible, limited to 4 threads and 4 CPUs, 31 GB RAM visible
Clips longer than 25 s are split with Silero VAD: 5 clip runs in total

"New" is the fairer scoring (casing, Unicode, punctuation, hyphen choice, digits vs spelled-out numbers, see README). "Old" is the round 1 scoring. WER and CER are over all clips of the language (errors summed, divided by reference length).

| Engine | Lang | WER new | CER new | WER old | CER old | RTF | Load | Peak RAM | Download | On disk | License |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet TDT 0.6B v3 int8 | hu | 30.9% | 11.1% | 31.7% | 11.4% | 0.125 | 5.8 s | 1507 MB | 487 MB | 671 MB | CC-BY-4.0 |
| Whisper large-v3-turbo int8 | hu | 15.5% | 4.3% | 15.7% | 4.4% | 0.390 | 8.3 s | 2541 MB | 564 MB | 1037 MB | MIT |
| Whisper large-v3 int8 | hu | 13.6% | 4.0% | 14.3% | 4.3% | 2.313 | 14.2 s | 5527 MB | 1068 MB | 1777 MB | MIT |
| BuzzASR Hungarian (large-v3 fine-tune) int8 | hu | 12.4% | 3.5% | 13.2% | 3.8% | 2.176 | 15.3 s | 5039 MB | 3.1 GB fp16 safetensors (HF), we export to int8 ourselves | 1776 MB | MIT |
| Canary-1B-v2 int8 (community export) | hu | 16.3% | 7.0% | 21.0% | 7.9% | 0.254 | 10.1 s | 1891 MB | 1.9 GB (HF YaroslavGor/sherpa-onnx-nemo-canary-1b-v2-int) | 1883 MB | CC-BY-4.0 (NVIDIA; the export repo says apache-2.0) |
| Parakeet TDT 0.6B v3 int8 | en | 6.8% | 3.1% | 7.9% | 4.0% | 0.138 | 4.6 s | 1476 MB | 487 MB | 671 MB | CC-BY-4.0 |
| Whisper large-v3-turbo int8 | en | 5.2% | 2.1% | 5.5% | 2.4% | 0.353 | 5.9 s | 2535 MB | 564 MB | 1037 MB | MIT |
| Whisper large-v3 int8 | en | 4.3% | 1.8% | 4.8% | 2.2% | 1.439 | 12.8 s | 5310 MB | 1068 MB | 1777 MB | MIT |
| Canary-1B-v2 int8 (community export) | en | 5.5% | 2.4% | 6.1% | 2.6% | 0.242 | 7.1 s | 1903 MB | 1.9 GB (HF YaroslavGor/sherpa-onnx-nemo-canary-1b-v2-int) | 1883 MB | CC-BY-4.0 (NVIDIA; the export repo says apache-2.0) |

## Findings

Hand-written, not regenerated. Numbers are the "new" scoring from the table above.

- Hungarian: BuzzASR fine-tune is best (12.4% WER, 3.5% CER), then stock large-v3 (13.6%), turbo (15.5%), Canary-1B-v2 (16.3%), Parakeet v3 (30.9%). Buzz vs large-v3 is only 1.2 points on 150 sentences, so treat them as close.
- English: large-v3 (4.3%), Canary (5.5%) and turbo (5.2%) are close, Parakeet v3 is behind (6.8%). All are good enough.
- Speed on 4 threads: large-v3 is slow (RTF 1.4 to 2.3, so a 10 minute entry takes 15 to 25 minutes, about 5.5 GB RAM). Turbo is RTF 0.35 to 0.39 (2.5 GB). Canary is 0.25 (1.9 GB). Parakeet is 0.13 (1.5 GB).
- Turbo costs about 2 points of Hungarian WER against large-v3 for 6x the speed and half the RAM. Canary is as fast as Parakeet, but its Hungarian CER (7.0%) is worse than all Whisper models: it makes more whole-word invention errors.
- Parakeet v3 Hungarian is bad here (30.9% WER). It auto-detects language and often writes Hungarian words with Finnish-like letters ("katalän", "tära"). The round 1 conclusion holds.
- Fairer scoring moves numbers by 0.2 to 1.5 points for most engines, and by 4.7 points for Canary in Hungarian (21.0% to 16.3%) because it writes numbers as words where the reference has digits. Engine order does not change except Canary moving from clearly worst Whisper-class to just behind turbo.
- Round 1 turbo scored 20.5% on 12 distinct sentences. On 150 distinct sentences it is 15.5%, so round 1 was too pessimistic.
- Beam search: not available. sherpa-onnx 2.0.3 only has a greedy decoder for Whisper, so the beam vs greedy comparison was skipped.
- BuzzASR is MIT. Its card says it was trained on FLEURS and Common Voice, so FLEURS is a friendly test for it. Expect the real-world gain over stock large-v3 to be smaller than here. Our own recordings will tell.
- BuzzASR is Hungarian only. It was not run on English. A bilingual setup needs a second model for English (turbo or large-v3).

## Caveats

- FLEURS is read, clean speech of Wikipedia-style sentences, not a journal spoken to a phone. Real recordings will have more errors. The own-clips mode exists for that.
- 150 sentences per language is enough to separate Parakeet from the rest and large Whisper from turbo, not enough to separate Buzz from large-v3.
- Canary-1B-v2 runs from a community int8 export (`YaroslavGor/sherpa-onnx-nemo-canary-1b-v2-int`, no model card, no downloads, repo license says apache-2.0, NVIDIA's own license is CC-BY-4.0). It worked through sherpa-onnx 2.0.3 with no changes, but we do not control that repo. Self-exporting would be needed for production.
- RTF and RAM are from one container run per engine and language on a laptop CPU (i7-12700H, 4 threads). A small home server will differ. Peak RAM is max RSS of the worker process.
- Scoring takes the best of four spelling variants per clip (see README), which is slightly generous to all engines. It was the same for every engine.
- Reference texts are FLEURS raw transcriptions. A few have their own oddities (unusual names), which cost every engine alike.

## Example errors

Clips at the 50th, 75th and 95th percentile of per-clip word error rate (only clips with errors). `[-reference-]{+heard+}`, words after new normalization.

### Parakeet TDT 0.6B v3 int8, hu

- Reference: A kéreg körülbelül 70 km vastag a közeli oldalon és 100 km vastag a túloldalon.
- Heard: A kérek körülbelül 60 km vastar, a közeli oldalon, és 100 km vastar a túloldalon.
- Diff (new scoring): a [-kéreg-]{+kérek+} körülbelül [-70-]{+60+} km [-vastag-]{+vastar+} a közeli oldalon és 100 km [-vastag-]{+vastar+} a túloldalon

- Reference: A rendszerinti bejelentések a metróban csak katalán nyelven hallhatóak, de a váratlan zavarok egy automatizált rendszeren keresztül több nyelven is hallhatóak, pl. spanyol, angol, francia, arab és japán.
- Heard: A rendszerinti pajjel, a metróban csak katalän nyelven halattua. Tära tavarok egy automatisált rendszerán keresztül több nyelven is halhattua, például spanyol, angol, francia, arab és japán.
- Diff (new scoring): a rendszerinti [-bejelentések-]{+pajjel+} a metróban csak [-katalán-]{+katalän+} nyelven [-hallhatóak-] [-de-] [-a-]{+halattua+} [-váratlan-]{+tära+} [-zavarok-]{+tavarok+} egy [-automatizált-]{+automatisált+} [-rendszeren-]{+rendszerán+} keresztül több nyelven is [-hallhatóak-]{+halhattua+} [-pl-]{+például+} spanyol angol francia arab és japán

- Reference: A marokkói szultán Daru l-Badya néven újjáépítette a várost, a spanyol kereskedők pedig a Casablanca nevet adták neki, és itt létesítették meg kereskedelmi bázisukat.
- Heard: A Morokkui Surtain Taru Elpát ja Népen ujai pirtättä a varos. A spanyol keräskötő penti katsoplankanäpä näki, és itlöytas nyt tätä keräsketä oni pääsukka.
- Diff (new scoring): a {+morokkui+} [-marokkói-]{+surtain+} [-szultán-]{+taru+} [-daru-]{+elpát+} [-l-]{+ja+} [-badya-]{+népen+} [-néven-]{+ujai+} [-újjáépítette-]{+pirtättä+} a [-várost-]{+varos+} a spanyol [-kereskedők-] [-pedig-] [-a-]{+keräskötő+} [-casablanca-]{+penti+} [-nevet-]{+katsoplankanäpä+} [-adták-]{+näki+} [-neki-]{+és+} [-és-]{+itlöytas+} [-itt-]{+nyt+} [-létesítették-]{+tätä+} [-meg-]{+keräsketä+} [-kereskedelmi-]{+oni+} [-bázisukat-]{+pääsukka+}

### Whisper large-v3-turbo int8, hu

- Reference: Az alvásmegszakítás a megszokott alvási ciklusból való szándékos ébredés, és rövid időn (10-60 perc) belüli visszaalvás folyamata.
- Heard: Az alvás megszakítás a megszokott alvási ciklusból való szendékos ébredés és rövid időn 10-60 perc belüli visszaalvás folyamata.
- Diff (new scoring): az {+alvás+} [-alvásmegszakítás-]{+megszakítás+} a megszokott alvási ciklusból való [-szándékos-]{+szendékos+} ébredés és rövid időn 10 60 perc belüli visszaalvás folyamata

- Reference: Szingapúr miniszterelnök-helyettese, Wong Kan Seng köszöntötte, és Szingapúr miniszterelnökével, Lee Hsien Loonggal tárgyalt a kereskedelmi és terrorizmus kérdésekről.
- Heard: Szingapur miniszterelnök helyettese, Wong Kan Seng köszöntötte, és Szingapur miniszterelnökével Lee Sien Loong-gal tárgyalt a kereskedelmi és terrorizmus kérdésekről.
- Diff (new scoring): [-szingapúr-]{+szingapur+} miniszterelnök helyettese wong kan seng köszöntötte és [-szingapúr-]{+szingapur+} miniszterelnökével lee {+sien+} [-hsien-]{+loong+} [-loonggal-]{+gal+} tárgyalt a kereskedelmi és terrorizmus kérdésekről

- Reference: Huhne lemondott, és Ed Davey országgyűlési képviselő veszi át a helyét a kormányban. Várhatóan Norman Lamb képviselő tölti majd be a Davey által üresen hagyott üzleti miniszteri posztot.
- Heard: Hún el a mondat, és Eddévi országgyűlési képviselő veszi át a helyét a kormányban. Várhatóan Normán Lem képviselő tölti majd be a Dévi által üres elhagyott üzleti minisztteri posztot.
- Diff (new scoring): {+hún+} [-huhne-]{+el+} [-lemondott-]{+a+} [-és-]{+mondat+} [-ed-]{+és+} [-davey-]{+eddévi+} országgyűlési képviselő veszi át a helyét a kormányban várhatóan [-norman-]{+normán+} [-lamb-]{+lem+} képviselő tölti majd be a [-davey-]{+dévi+} által [-üresen-]{+üres+} [-hagyott-]{+elhagyott+} üzleti [-miniszteri-]{+minisztteri+} posztot

### Whisper large-v3 int8, hu

- Reference: Ugyanakkor több ország bankjegyeihez is készített metszeteket, utóbbi munkái között megemlíthetők az új kanadai 5 és 100 dolláros bankjegyekhez készített miniszterelnöki portrék.
- Heard: Ugyanakkor több ország bankjegyeihez is készített megszeteket, utóbbi munkájuk között megemlíthető az új Kanadai 5 és 100 dolláros bankjegyekhez készített miniszterelnöki portrék.
- Diff (new scoring): ugyanakkor több ország bankjegyeihez is készített [-metszeteket-]{+megszeteket+} utóbbi [-munkái-]{+munkájuk+} között [-megemlíthetők-]{+megemlíthető+} az új kanadai 5 és 100 dolláros bankjegyekhez készített miniszterelnöki portrék

- Reference: Keverje össze a két száraz port, majd préselje őket golyóvá tiszta, nedves kézzel.
- Heard: Keverje össze a két száraz pot, majd presselje őket kujulva tiszta, nedves kézzel.
- Diff (new scoring): keverje össze a két száraz [-port-]{+pot+} majd [-préselje-]{+presselje+} őket [-golyóvá-]{+kujulva+} tiszta nedves kézzel

- Reference: A gízai nagy piramis az egyetlen a hét csodából, amely még ma is áll.
- Heard: A kíza a nagy piramis az egyes lana hét csatából, amely még ma is áll.
- Diff (new scoring): a {+kíza+} [-gízai-]{+a+} nagy piramis az [-egyetlen-]{+egyes+} [-a-]{+lana+} hét [-csodából-]{+csatából+} amely még ma is áll

### BuzzASR Hungarian (large-v3 fine-tune) int8, hu

- Reference: Kiegyensúlyozott atlétaként a tigris képes fára mászni (bár nem túl jól), úszni, nagy távolságra ugrani és egy erős ember erejének ötszörösével húzni.
- Heard: Kiegyensúlyozott atlétaként a tigr is képes fára mászni bár nem túl jól úszni nagy távolságra ugrani és egy erős ember erejének összörösével húzni
- Diff (new scoring): kiegyensúlyozott atlétaként a {+tigr+} [-tigris-]{+is+} képes fára mászni bár nem túl jól úszni nagy távolságra ugrani és egy erős ember erejének [-ötszörösével-]{+összörösével+} húzni

- Reference: Hírneve, mint a luxus epicentruma körülbelül i.sz. 400-ban kezdődött  és körülbelül i.sz. 1100-ig tartott.
- Heard: hírneve mint a luxus epicentruma körülbelül időszámításunk szerint 400 ban kezdődött és körülbelül időszámításunk szerint 1100 ig tartott
- Diff (new scoring): hírneve mint a luxus epicentruma körülbelül [-i-]{+időszámításunk+} [-sz-]{+szerint+} 400 ban kezdődött és körülbelül [-i-]{+időszámításunk+} [-sz-]{+szerint+} 1100 ig tartott

- Reference: Később áthelyezték a cambridge-i Addenbrooke's Kórházba.
- Heard: Később áthelyezték a cambridges-i Edinburgh-brooks kórházba
- Diff (new scoring): később áthelyezték a [-cambridgei-]{+cambridgesi+} [-addenbrookes-]{+edinburghbrooks+} kórházba

### Canary-1B-v2 int8 (community export), hu

- Reference: Olaszország számos más városában és a világ többi részén, különösen Lengyelországban, hasonló szerelvényeket állítottak fel, amelyen rengeteg ember követhette az eseményt.
- Heard: Olaszország számos más városában és a világ többi részén, különösen Lengyelországban hasonló szelelvényre tett állítottak fel, amelyen rendetlen ember követhette az eseményt.
- Diff (new scoring): olaszország számos más városában és a világ többi részén különösen lengyelországban hasonló {+szelelvényre+} [-szerelvényeket-]{+tett+} állítottak fel amelyen [-rengeteg-]{+rendetlen+} ember követhette az eseményt

- Reference: Az emberek manapság már a számítógép képernyőjére írnak üzenetet és sosem kerülnek egy hegyező közelébe.
- Heard: Az emberek manapság már a számítógép képernyőire nyernek üteneteket, és sosem kerülnek egy hegyeső közelébe.
- Diff (new scoring): az emberek manapság már a számítógép [-képernyőjére-]{+képernyőire+} [-írnak-]{+nyernek+} [-üzenetet-]{+üteneteket+} és sosem kerülnek egy [-hegyező-]{+hegyeső+} közelébe

- Reference: Az amerikai mérnöktestület becslése szerint 6 hüvelyknyi csapadék már megrepesztheti a korábban megsérült töltéseket.
- Heard: Az amerikai mérnök testület becslése szerint hat hüvelyk a csapaté, már megrapedheti a korábban megsérült töréseket.
- Diff (new scoring): az amerikai {+mérnök+} [-mérnöktestület-]{+testület+} becslése szerint hat {+hüvelyk+} [-hüvelyknyi-]{+a+} [-csapadék-]{+csapaté+} már [-megrepesztheti-]{+megrapedheti+} a korábban megsérült [-töltéseket-]{+töréseket+}

### Parakeet TDT 0.6B v3 int8, en

- Reference: The disease is carried by pigs, which then migrates to humans through mosquitos.
- Heard: The disease is carried by pigs, which then migrates to humans through mosquitoes.
- Diff (new scoring): the disease is carried by pigs which then migrates to humans through [-mosquitos-]{+mosquitoes+}

- Reference: The 802.11n standard operates on both the 2.4Ghz and 5.0Ghz frequencies.
- Heard: The 802.11 in standard operates on both the 2.4 GHC and 5.0 ghc frequencies.
- Diff (new scoring): the eight hundred two point eleven [-n-]{+in+} standard operates on both the two point four [-ghz-]{+ghc+} and five point zero [-ghz-]{+ghc+} frequencies

- Reference: The composition of these crystals matches those found in the urine of affected pets when compared by infrared spectroscopy (FTIR).
- Heard: The composition of these crystals matches those found in urine of affected pets when compared by infrared spectroscopy. F T I R
- Diff (new scoring): the composition of these crystals matches those found in [-the-] urine of affected pets when compared by infrared spectroscopy {+f+} {+t+} {+i+} [-ftir-]{+r+}

### Whisper large-v3-turbo int8, en

- Reference: Six hostages, including the children and elderly, were released early, as were the Filipino photographers.
- Heard: Six hostages, including the children elderly, were released early, as were the Filipino photographers.
- Diff (new scoring): six hostages including the children [-and-] elderly were released early as were the filipino photographers

- Reference: Their disciplined defence, ball handling skills and excellent team work made them stand out and it was clear that this was the team to beat.
- Heard: Their disciplined defense, ball handling skills, and excellent teamwork made them stand out and it was clear that this was the team to beat.
- Diff (new scoring): their disciplined [-defence-]{+defense+} ball handling skills and excellent [-team-] [-work-]{+teamwork+} made them stand out and it was clear that this was the team to beat

- Reference: Vatican City's population is around 800. It is the smallest independent country in the world and the country with the lowest population.
- Heard: Vatican City population is around 800. It is the smallest independent country in the world and the population.
- Diff (new scoring): vatican [-citys-]{+city+} population is around 800 it is the smallest independent country in the world and [-the-] [-country-] [-with-] the [-lowest-] population

### Whisper large-v3 int8, en

- Reference: The age where the events took place is commonly referred as the High Middle Ages the period of European history in the 11th, 12th, and 13th centuries (AD 1000–1300).
- Heard: The age where the events took place is commonly referred as the High Middle Ages, the period of European history in the 11th, 12th, and 13th centuries, A.D. 1000-1300.
- Diff (new scoring): the age where the events took place is commonly referred as the high middle ages the period of european history in the 11th 12th and 13th centuries {+a+} [-ad-]{+d+} 1000 1300

- Reference: During the struggle for independence organised by the Mau movement, a peaceful gathering in the town resulted in the killing of the paramount chief Tupua Tamasese Lealofi III.
- Heard: During the struggle for independence organized by the Mao movement, a peaceful gathering in the town resulted in the killing of the paramount chief, Tupua Tamasese Leolofi III.
- Diff (new scoring): during the struggle for independence [-organised-]{+organized+} by the [-mau-]{+mao+} movement a peaceful gathering in the town resulted in the killing of the paramount chief tupua tamasese [-lealofi-]{+leolofi+} iii

- Reference: Vatican City's population is around 800. It is the smallest independent country in the world and the country with the lowest population.
- Heard: Vatican City population is around 800. It is the smallest independent country in the world and the population
- Diff (new scoring): vatican [-citys-]{+city+} population is around 800 it is the smallest independent country in the world and [-the-] [-country-] [-with-] the [-lowest-] population

### Canary-1B-v2 int8 (community export), en

- Reference: The harbor was the site of an infamous naval standoff in 1889 when seven ships from Germany, the US, and Britain refused to leave the harbor.
- Heard: The harbour was the site of an infamous naval standoff in 1889 when seven ships from Germany, the US and Britain refused to leave the harbour.
- Diff (new scoring): the [-harbor-]{+harbour+} was the site of an infamous naval standoff in 1889 when seven ships from germany the us and britain refused to leave the [-harbor-]{+harbour+}

- Reference: The presence of a true “invisible team” (Larson and LaFasto, 1989, p109) is also a unique component of a virtual team.
- Heard: The presence of the true invisible team Larson and Lefasto 1989 page 109 is also a unique component of a virtual team.
- Diff (new scoring): the presence of [-a-]{+the+} true invisible team larson and [-lafasto-]{+lefasto+} nineteen eighty nine [-p-]{+page+} one hundred nine is also a unique component of a virtual team

- Reference: Their disciplined defence, ball handling skills and excellent team work made them stand out and it was clear that this was the team to beat.
- Heard: Their discipline, defense, ball handling skills and excellent teamwork made them stand out, and it was clear that this was the team to be beaten.
- Diff (new scoring): their [-disciplined-]{+discipline+} [-defence-]{+defense+} ball handling skills and excellent [-team-] [-work-]{+teamwork+} made them stand out and it was clear that this was the team to {+be+} [-beat-]{+beaten+}

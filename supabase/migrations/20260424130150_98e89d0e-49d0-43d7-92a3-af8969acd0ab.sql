-- ─────────────────────────────────────────────────────────────────────────────
-- Reseed History syllabi (2261 + 2126) with the canonical AO/LO/KO dataset.
-- Idempotent: wipes the existing AOs + topics for these two docs and re-inserts.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migration$
DECLARE
  doc_ids uuid[] := ARRAY[
    '51ed087a-c0bc-4c94-ac32-e676095b9796'::uuid,  -- Sec 4   Combined Humanities (History) 2261
    'e648a761-8542-4809-a008-cbc246fb4d0b'::uuid   -- Sec 4N  Combined Humanities (History) 2126
  ];
  doc_id uuid;
  pos int;
BEGIN
  FOREACH doc_id IN ARRAY doc_ids LOOP

    ----------------------------------------------------------------------------
    -- 1. Wipe stale rows for this doc.
    ----------------------------------------------------------------------------
    DELETE FROM public.syllabus_assessment_objectives WHERE source_doc_id = doc_id;
    DELETE FROM public.syllabus_topics                WHERE source_doc_id = doc_id;

    ----------------------------------------------------------------------------
    -- 2. Reseed Assessment Objectives (3 rows: AO1 / AO2 / AO3).
    ----------------------------------------------------------------------------
    INSERT INTO public.syllabus_assessment_objectives
      (source_doc_id, code, title, description, weighting_percent, position)
    VALUES
      (doc_id, 'AO1', 'Deploy Knowledge',
       'Select, organise and use relevant historical knowledge in context.',
       NULL, 0),

      (doc_id, 'AO2', 'Construct Explanation and Communicate Historical Knowledge',
       'Analyse and explain historical events and periods studied using key historical concepts (causation and consequence, change and continuity, significance) in order to arrive at a reasoned conclusion. Command words: "Explain…", "Given a hypothesis (quote), how far do you agree…".',
       NULL, 1),

      (doc_id, 'AO3', 'Interpret and Evaluate Source Materials',
       E'Interpret, evaluate and use a range of sources as evidence in their historical context, through the following sub-skills:\n'
       '• Comprehension — comprehending and extracting relevant information.\n'
       '• Inference — drawing inferences from given information. Command words: "infer", "message", "what does it tell you".\n'
       '• Comparison — comparing and contrasting different views. Command words: "compare", "how similar", "how different", "how far are sources similar/different".\n'
       '• Reliability — distinguishing between facts, opinion and judgement. Command words: "how reliable", "how far can we trust", "how accurate", "how far can one source prove another wrong", "are you surprised".\n'
       '• Purpose & bias — recognising values and detecting bias. Command words: "purpose", "why was this source created", "do you think X would have agreed with the source", "are you surprised".\n'
       '• Utility — establishing utility of given information. Command words: "how useful", "how far can one source prove another wrong".\n'
       '• Drawing conclusions — drawing conclusions based on a reasoned consideration of evidence and arguments. Command words: "given an assertion or hypothesis, how far do the sources support the assertion or hypothesis".',
       NULL, 2);

    ----------------------------------------------------------------------------
    -- 3. Reseed Topics — 20 LO/KO bands.
    --    learning_outcomes  = the verbatim LO statement(s) for this band.
    --    outcome_categories = the KO content bullets (the "what to study").
    --    ao_codes           = AOs typically tested for this band.
    --    section            = 'A', 'B', or 'A, B'.
    --    topic_code         = LO band number (1–6) from the dataset.
    --    parent_code        = grouping heading (e.g. "The Cold War").
    ----------------------------------------------------------------------------
    pos := 0;

    -- ── LO band 1 — Post-war peace settlements ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '1', 'Post-war peace settlements',
       'Assess the impact of post-war peace settlements on Europe.',
       ARRAY['Assess the impact of post-war peace settlements on Europe.'],
       ARRAY[
         'Aims and terms of the Paris Peace Conference and its immediate impact on Europe in the 1920s',
         'Treaty of Versailles and its immediate impact on Germany — War Guilt Clause, reparations, demilitarisation, territorial reductions',
         'Re-drawing of national boundaries and the creation of new nation-states — breakdown of old empires, self-determination'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    -- ── LO band 2 — Collective security in the 1920s ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '2', 'Collective security in the 1920s',
       'Assess the attempts at collective security in the 1920s and its outcomes.',
       ARRAY['Assess the attempts at collective security in the 1920s and its outcomes.'],
       ARRAY[
         'Attempts at collective security in the 1920s',
         'Successes and failures of the League of Nations at peacekeeping in the 1920s'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    -- ── LO band 3 — Authoritarian regimes (Nazi Germany case study) ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '3', 'Authoritarian regimes — Nazi Germany',
       'Examine the rise of authoritarian regimes (Nazi Germany) and evaluate the roles of key players in the establishment of authoritarian rule.',
       ARRAY['Examine the rise of authoritarian regimes and evaluate the roles of key players in the establishment of authoritarian rule.'],
       ARRAY[
         'Case Study of Nazi Germany — Circumstances leading to the rise and establishment of authoritarian rule',
         'Weaknesses of the Weimar government — problems of the Weimar constitution, unpopularity of the Weimar government',
         'Appeal of Hitler and the Nazi Party — role of Hitler; methods of the Nazi Party (use of propaganda and force, participation in elections)',
         'Economic challenges — inflation, unemployment, Great Depression'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '3', 'Authoritarian regimes — Nazi Germany',
       'Evaluate the impact of authoritarian regimes (Nazi Germany) on the political, economic and social context of the country.',
       ARRAY['Evaluate the impact of authoritarian regimes on the political, economic and social context of countries.'],
       ARRAY[
         'Case Study of Nazi Germany — Consolidation of Nazi rule in Germany',
         'Establishment of Hitler''s dictatorship and one-party rule',
         'Economic policies — re-employment and improvement of working conditions; move towards war economy',
         'Social policies — German nationalism and persecution of ethnic and minority groups; control of, and responses by, German society'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    -- ── LO band 3 — Authoritarian regimes (Militarist Japan case study) ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '3', 'Authoritarian regimes — Militarist Japan',
       'Examine the rise of authoritarian regimes (Militarist Japan, 1920s–30s) and evaluate the roles of key players.',
       ARRAY['Examine the rise of authoritarian regimes and evaluate the roles of key players in the establishment of authoritarian rule.'],
       ARRAY[
         'Case Study of Militarist Japan, 1920s–1930s — Circumstances leading to the rise and establishment of authoritarian regime',
         'Weaknesses of the democratic government in Japan',
         'Economic challenges — inflation, unemployment, landlord-tenant disputes, Great Depression',
         'Appeal of ultranationalist faction — military successes and political assassinations'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '3', 'Authoritarian regimes — Militarist Japan',
       'Evaluate the impact of authoritarian regimes (Militarist Japan) on the political, economic and social context of the country.',
       ARRAY['Evaluate the impact of authoritarian regimes on the political, economic and social context of countries.'],
       ARRAY[
         'Case Study of Militarist Japan, 1920s–1930s — Increased influence of the militarists from the 1930s',
         'Consolidation of military power in the government',
         'Economic policies — increased government control over industry and campaign for economic revitalisation',
         'Social policies — militarisation of education; control of labour unions'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    -- ── LO band 4 — Outbreak of WWII in Europe ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '4', 'War in Europe and the Asia-Pacific',
       'Evaluate the reasons for the outbreak of World War II in Europe, and the roles played by individuals and groups.',
       ARRAY[
         'Evaluate the reasons for the outbreak of World War II in Europe.',
         'Evaluate the roles played by individuals and groups in developments leading to the outbreak of World War II.'
       ],
       ARRAY[
         'Key developments leading to the outbreak of World War II in Europe',
         'Ineffectiveness of the League of Nations in the 1930s — failure of disarmament; Abyssinian Crisis (1935) and its implications',
         'Germany''s aggressive foreign policy — Plebiscite in the Saar region (1935); Remilitarisation of the Rhineland (1936); Anschluss with Austria (1938); Munich Agreement and invasion of Czechoslovakia (1938–1939); Nazi–Soviet Non-Aggression Pact and invasion of Poland (1939)',
         'Policy of appeasement'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    -- ── LO band 4 — Outbreak of WWII in Asia-Pacific ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '4', 'War in Europe and the Asia-Pacific',
       'Evaluate the reasons for the outbreak of World War II in the Asia–Pacific, and the roles played by individuals and groups.',
       ARRAY[
         'Evaluate the reasons for the outbreak of World War II in the Asia–Pacific.',
         'Evaluate the roles played by individuals and groups in developments leading to the outbreak of World War II.'
       ],
       ARRAY[
         'Key developments leading to the outbreak of World War II in the Asia–Pacific',
         'Ineffectiveness of the League of Nations in the 1930s',
         'Worsening of US–Japan relations',
         'Japan''s expansionist foreign policy — aggression towards China from 1937; Greater East Asia Co-Prosperity Sphere; Bombing of Pearl Harbour (1941)'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    -- ── LO band 4 — End of WWII ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '4', 'War in Europe and the Asia-Pacific',
       'Assess the reasons for the end of World War II.',
       ARRAY['Assess the reasons for the end of World War II.'],
       ARRAY[
         'Reasons for the end of World War II',
         'Strengths of the Allies — American entry into the war (economic resources and manpower); Allied strategies (D-Day, island hopping, dropping of the atomic bomb); role of the Soviet Union',
         'Military weaknesses of Germany — ineffective command structure; war on two fronts',
         'Military weaknesses of Japan — overextension of empire; inability to access raw materials from empire',
         'Awareness of major turning points of the war (no detailed military campaign study required)'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    -- ── LO band 5 — Cold War origins in Europe (4 LOs collapsed onto one shared KO) ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'The Cold War',
       'Assess the immediate impact of WWII on Europe and the origins of the Cold War.',
       ARRAY['Assess the immediate impact of World War II on Europe.'],
       ARRAY[
         'End of World War II and its impact on Europe — circumstances in post-war Europe; emergence of the USA and USSR as superpowers',
         'Growing mistrust between USA and USSR — differences in ideology; breakdown of wartime alliances; division of Europe after WWII',
         'Intensification of superpower rivalry — American containment policy (political, economic, military); Soviet responses (political, economic, military)'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'The Cold War',
       'Examine how Cold War tensions were manifested in Europe.',
       ARRAY['Examine how Cold War tensions were manifested in Europe.'],
       ARRAY[
         'Manifestations of Cold War tensions in Europe — division of Europe; Berlin Blockade and Airlift; formation of NATO and Warsaw Pact',
         'American containment policy in Europe — Truman Doctrine, Marshall Plan',
         'Soviet responses in Europe — Cominform, COMECON'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'The Cold War',
       'Assess the impact of rivalry between the USA and USSR in the aftermath of World War II.',
       ARRAY['Assess the impact of rivalry between the USA and USSR in the aftermath of World War II.'],
       ARRAY[
         'Impact of US–USSR rivalry — arms race; division of Germany; ideological polarisation of Europe',
         'Spread of superpower rivalry beyond Europe'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'The Cold War',
       'Assess the impact of the emergence of Communist China on Cold War tensions.',
       ARRAY['Assess the impact of the emergence of Communist China on Cold War tensions.'],
       ARRAY[
         'Emergence of Communist China (1949) and its global impact',
         'Sino–Soviet Alliance and the expansion of the communist bloc',
         'Shift of US containment focus to Asia'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    -- ── LO band 5 — Korean War case study (3 LOs) ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'Cold War — Korean War 1950–53',
       'Assess the reasons for the outbreak of the Korean War and its aftermath.',
       ARRAY['Assess the reasons for the outbreak of the Korean War and the Vietnam War, and their aftermath.'],
       ARRAY[
         'Post World War II developments in Korea — post-war occupation; partition of Korea; border clashes',
         'Emergence of communist China — expansion of a communist bloc; Sino–Soviet Alliance',
         'Outbreak of the Korean War — role of key players (North Korea, South Korea, USA, UN, China, USSR)',
         'The Korean Armistice Agreement and the immediate aftermath — demilitarised zone; impact on US policy in Asia; escalation of NATO–Warsaw Pact tension'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'Cold War — Korean War 1950–53',
       'Evaluate the extent and impact of superpower involvement in the Korean War.',
       ARRAY['Evaluate the extent and impact of superpowers involvement in civil wars with reference to the Korean War and the Vietnam War.'],
       ARRAY[
         'US involvement — UN Command, troop commitments, containment in Asia',
         'Soviet involvement — material aid, air support',
         'Chinese involvement — People''s Volunteer Army intervention',
         'Impact on the Korean peninsula and on Cold War alignments'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'Cold War — Korean War 1950–53',
       'Examine the immediate aftermath of the Korean War on Cold War developments.',
       ARRAY['Examine the immediate aftermath of the Korean War and the Vietnam War on Cold War developments.'],
       ARRAY[
         'Korean Armistice Agreement and the demilitarised zone',
         'Hardening of US containment policy in Asia',
         'Escalation of tension between NATO and Warsaw Pact'
       ],
       ARRAY['AO1','AO2','AO3'],
       ARRAY['Understand','Analyse','Evaluate'],
       'A, B', 0, pos);
    pos := pos + 1;

    -- ── LO band 5 — Vietnam War case study (3 LOs) ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'Cold War — Vietnam War 1954–75',
       'Assess the reasons for the outbreak of the Vietnam War and its aftermath.',
       ARRAY['Assess the reasons for the outbreak of the Korean War and the Vietnam War, and their aftermath.'],
       ARRAY[
         'Key developments in North and South Vietnam in the 1950s — partition of Vietnam (1954); consolidation of communist control in the North; instability in the South',
         'Discontentment over the Geneva Accords; failure to carry out national elections in 1956',
         'Unpopularity of Ngo Dinh Diem''s actions and northern support for southern insurgency',
         'Escalation of tensions between North and South Vietnam from 1954',
         'Role of key players — North Vietnam, South Vietnam, USA, USSR, China',
         'End of the Vietnam War and the immediate aftermath — reunification of Vietnam; beginning of détente'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'Cold War — Vietnam War 1954–75',
       'Evaluate the extent and impact of superpower involvement in the Vietnam War.',
       ARRAY['Evaluate the extent and impact of superpowers involvement in civil wars with reference to the Korean War and the Vietnam War.'],
       ARRAY[
         'US involvement — military advisors, escalation under Johnson, Vietnamisation under Nixon',
         'Soviet and Chinese support to North Vietnam',
         'Impact on Vietnam and on the wider Cold War'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '5', 'Cold War — Vietnam War 1954–75',
       'Examine the immediate aftermath of the Vietnam War on Cold War developments.',
       ARRAY['Examine the immediate aftermath of the Korean War and the Vietnam War on Cold War developments.'],
       ARRAY[
         'Reunification of Vietnam (1976)',
         'Beginning of détente',
         'Reassessment of US foreign policy in Asia'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    -- ── LO band 6 — End of the Cold War ──
    INSERT INTO public.syllabus_topics
      (source_doc_id, paper_id, topic_code, parent_code, title,
       learning_outcomes, outcome_categories, ao_codes, suggested_blooms,
       section, depth, position)
    VALUES
      (doc_id, NULL, '6', 'End of the Cold War',
       'Assess the reasons that led to the decline of the USSR and the end of the Cold War.',
       ARRAY[
         'Assess the reasons that led to the decline of the USSR.',
         'Evaluate the reasons for the end of the Cold War.'
       ],
       ARRAY[
         'Decline of the USSR and the end of the Cold War',
         'Ineffectiveness of Soviet command economy — structural weaknesses and their effect on Soviet standards of living',
         'External economic burdens of the USSR — increased military spending; resistance within the communist bloc; commitment to Warsaw Pact',
         'Escalation of USA–USSR tensions in the 1980s — US economic might and re-intensification of arms race',
         'Impact of Gorbachev''s economic and political reforms — failure to revive the Soviet economy; loss of confidence in the Soviet government; collapse of the Eastern European bloc; disintegration of the USSR'
       ],
       ARRAY['AO1','AO2'],
       ARRAY['Understand','Analyse','Evaluate'],
       'B', 0, pos);
    pos := pos + 1;

    ----------------------------------------------------------------------------
    -- 4. Touch the parent doc so admin UI shows it changed.
    ----------------------------------------------------------------------------
    UPDATE public.syllabus_documents
       SET updated_at = now(),
           parse_status = 'parsed'
     WHERE id = doc_id;

  END LOOP;
END
$migration$;
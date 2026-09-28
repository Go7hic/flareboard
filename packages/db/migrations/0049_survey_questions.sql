-- Surveys: multi-question surveys with branching, structured responses, targeting limits,
-- hosted survey links and appearance settings.
--
-- survey.questions is a JSON array of up to 10 questions (see packages/shared/src/surveys.ts).
-- The legacy question, type and options columns stay as a mirror of the first question for
-- older readers and trackers released before multi-question surveys.
-- survey_response.answers is a JSON object keyed by question id. The legacy answer column
-- keeps the first answered question as text (feedback inbox, session timeline, warehouse).
-- completed = 0 marks a partial response (dismissed mid-way).
ALTER TABLE `survey` ADD COLUMN `questions` text;
ALTER TABLE `survey` ADD COLUMN `appearance` text;
ALTER TABLE `survey` ADD COLUMN `sample_rate` integer NOT NULL DEFAULT 100;
ALTER TABLE `survey` ADD COLUMN `response_limit` integer;
ALTER TABLE `survey` ADD COLUMN `starts_at` integer;
ALTER TABLE `survey` ADD COLUMN `ends_at` integer;
ALTER TABLE `survey` ADD COLUMN `repeat_interval_days` integer;
ALTER TABLE `survey` ADD COLUMN `hosted_enabled` integer NOT NULL DEFAULT 0;
ALTER TABLE `survey` ADD COLUMN `slug` text;

CREATE UNIQUE INDEX IF NOT EXISTS `survey_slug_unique` ON `survey` (`slug`);

ALTER TABLE `survey_response` ADD COLUMN `answers` text;
ALTER TABLE `survey_response` ADD COLUMN `completed` integer NOT NULL DEFAULT 1;
ALTER TABLE `survey_response` ADD COLUMN `source` text NOT NULL DEFAULT 'widget';
ALTER TABLE `survey_response` ADD COLUMN `distinct_id` text;
ALTER TABLE `survey_response` ADD COLUMN `updated_at` integer;

CREATE INDEX IF NOT EXISTS `survey_response_survey_created_idx` ON `survey_response` (`survey_id`, `created_at`);

-- Every existing survey becomes one question with id q1, matching legacySurveyQuestion():
-- text becomes open, rating becomes a 1-5 rating, the NPS template (choice 0..10) becomes an
-- NPS rating and any other choice survey becomes single choice.
UPDATE `survey`
SET `questions` = json_array(
  CASE
    WHEN `type` = 'rating' THEN
      json_object('id', 'q1', 'type', 'rating', 'question', `question`, 'scale', 5)
    WHEN `type` = 'choice' AND `options` = '["0","1","2","3","4","5","6","7","8","9","10"]' THEN
      json_object('id', 'q1', 'type', 'rating', 'question', `question`, 'scale', 'nps')
    WHEN `type` = 'choice' THEN
      json_object(
        'id', 'q1',
        'type', 'single_choice',
        'question', `question`,
        'options',
        CASE
          WHEN json_valid(`options`) AND json_type(`options`) = 'array' THEN json(`options`)
          ELSE json('[]')
        END
      )
    ELSE json_object('id', 'q1', 'type', 'open', 'question', `question`)
  END
)
WHERE `questions` IS NULL;

-- Existing responses answered that single question.
UPDATE `survey_response`
SET `answers` = json_object('q1', `answer`)
WHERE `answers` IS NULL;

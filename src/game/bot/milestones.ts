/**
 * Долгие цели бота.
 *
 * Языковая модель выбирает направление, но не раскладывает его на десятки
 * мелких покупок. Локальный планировщик доводит цель до игровых требований:
 * лаборатории, технологий, верфи и, наконец, нужного корпуса. Поэтому курс
 * переживает редкие обращения к модели и не расходует лимит на каждый тик.
 */
export const BOT_MILESTONES = [
  'EXPEDITION_PROGRAM',
  'INTERSTELLAR_REACH',
  'RECYCLING_CORPS',
  'SECOND_COLONY',
  'THIRD_COLONY',
  'CRUISER_CORE',
  'FRIGATE_SCREEN',
  'BOMBER_WING',
  'BATTLESHIP_LINE',
  'CARRIER_GROUP',
  'FORTIFIED_CAPITAL',
  'SYNDICATE_BUILDER',
  'GATE_NETWORK',
] as const;

export type BotMilestone = (typeof BOT_MILESTONES)[number];

export const BOT_MILESTONE_LABELS: Record<BotMilestone, string> = {
  EXPEDITION_PROGRAM: 'регулярные экспедиции',
  INTERSTELLAR_REACH: 'межзвездная логистика',
  RECYCLING_CORPS: 'переработка обломков',
  SECOND_COLONY: 'вторая колония',
  THIRD_COLONY: 'третья колония',
  CRUISER_CORE: 'крейсерское ядро',
  FRIGATE_SCREEN: 'фрегатное прикрытие',
  BOMBER_WING: 'бомбардировочное крыло',
  BATTLESHIP_LINE: 'линейные корабли',
  CARRIER_GROUP: 'авианосная группа',
  FORTIFIED_CAPITAL: 'укрепленная столица',
  SYNDICATE_BUILDER: 'развитый синдикат',
  GATE_NETWORK: 'сеть Брам',
};

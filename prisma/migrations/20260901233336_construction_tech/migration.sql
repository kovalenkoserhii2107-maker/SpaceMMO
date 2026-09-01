-- Две технологии скорости: «Робототехника» ускоряет стройку и верфь,
-- «Сжатие времени» вдвое сокращает все сроки ценой удвоения расхода энергии.
--
-- Значения добавляются в конец: порядок в БД совпадет с порядком
-- в schema.prisma, и Prisma не будет видеть дрейф схемы.
ALTER TYPE "TechnologyType" ADD VALUE 'ROBOTICS' AFTER 'ASTROPHYSICS';
ALTER TYPE "TechnologyType" ADD VALUE 'TIME_COMPRESSION' AFTER 'ROBOTICS';

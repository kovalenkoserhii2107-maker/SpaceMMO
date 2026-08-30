# Растровые иллюстрации

Сюда кладутся картинки объектов. Клиент ищет их по имени типа в нижнем регистре:

| Папка | Пример пути | Откуда берется имя |
| --- | --- | --- |
| `buildings/` | `/assets/buildings/ore_mine.webp` | значение `BuildingType` |
| `ships/` | `/assets/ships/heavy_cruiser.webp` | значение `ShipType` |
| `defense/` | `/assets/defense/cannon_turret.webp` | значение `DefenseType` |
| `tech/` | `/assets/tech/mining_tech.webp` | значение `TechnologyType` |
| `planets/` | `/assets/planets/ice.webp` | биом планеты (маппинг `PLANET_ART`) |

Полный список ожидаемых файлов:

**buildings:** `ore_mine`, `polymer_plant`, `plasma_reactor`, `power_plant`,
`science_center`, `shipyard`, `antimatter_factory`, `storage`

**ships:** `probe`, `transporter`, `light_fighter`, `heavy_cruiser`, `ion_frigate`,
`recycler`

**defense:** `cannon_turret`, `laser_turret`

**tech:** `energy_tech`, `computing_tech`, `mining_tech`, `combustion_drive`,
`hyperspace_physics`, `hyperdrive`, `astrophysics`

**planets:** `rocky`, `terran`, `desert`, `ice`, `gas_giant`, `lava`, `toxic` — тела
по биому; `star` и `black_hole` — центр системы; `deep_space` — точка выхода
за орбиты. Картинка привязана к биому, а не к орбите: ледяной мир выглядит ледяным
в любой системе.

Имена биомов намеренно не совпадают с перечислением `PlanetType`: арт назван по виду
(`terran`, `lava`), а тип — по свойству (`OCEANIC`, `VOLCANIC`). Связывает их маппинг
`PLANET_ART` в `public/app.js` — добавляя биом, впиши его туда.

Звезда, черная дыра и туманность глубокого космоса рисуются иначе, чем планеты:
их не обрезают кругом, а черный фон убирается режимом `mix-blend-mode: screen`.
Планетам смешивание не применяется — под ним они стали бы полупрозрачными;
им достаточно круглой обрезки, срезающей углы черного квадрата.

Формат — `.webp`, квадрат (рекомендуется 512×512): обложка карточки — строгий
квадрат, а тела на карте обрезаются по кругу. Пока файла нет, на его месте
стоит заглушка — квадратная в карточке и цветной круг на карте, — и верстка
от этого не ломается.

Имя файла обязано совпадать с типом объекта в нижнем регистре — таблицы
соответствий в коде нет намеренно. Если картинка не появилась, первым делом
сверь имя со списком выше.

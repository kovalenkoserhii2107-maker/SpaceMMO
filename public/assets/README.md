# Растровые иллюстрации

Сюда кладутся картинки объектов. Клиент ищет их по имени типа в нижнем регистре:

| Папка | Пример пути | Откуда берется имя |
| --- | --- | --- |
| `buildings/` | `/assets/buildings/ore_mine.webp` | значение `BuildingType` |
| `ships/` | `/assets/ships/heavy_cruiser.webp` | значение `ShipType` |
| `defense/` | `/assets/defense/cannon_turret.webp` | значение `DefenseType` |
| `tech/` | `/assets/tech/mining_tech.webp` | значение `TechnologyType` |
| `planets/` | `/assets/planets/ice.webp` | значение `PlanetType` |

Полный список ожидаемых файлов:

**buildings:** `ore_mine`, `polymer_plant`, `plasma_reactor`, `power_plant`,
`science_center`, `shipyard`, `antimatter_factory`, `storage`

**ships:** `probe`, `transporter`, `light_fighter`, `heavy_cruiser`, `ion_frigate`,
`recycler`

**defense:** `cannon_turret`, `laser_turret`

**tech:** `energy_tech`, `computing_tech`, `mining_tech`, `combustion_drive`,
`hyperspace_physics`, `hyperdrive`, `astrophysics`

**planets:** `rocky`, `oceanic`, `desert`, `ice`, `gas_giant`, `volcanic`, `toxic` —
тела по типу планеты; `star` и `black_hole` — центр системы; `deep_space` — точка
выхода за орбиты. Картинка привязана к типу, а не к орбите: ледяной мир выглядит
ледяным в любой системе. Пока файла нет, на карте остается круглая заглушка цвета
этого типа.

Формат — `.webp`, квадрат (рекомендуется 512×512): обложка карточки — строгий
квадрат, а тела на карте обрезаются по кругу. Пока файла нет, на его месте
стоит заглушка — квадратная в карточке и цветной круг на карте, — и верстка
от этого не ломается.

Имя файла обязано совпадать с типом объекта в нижнем регистре — таблицы
соответствий в коде нет намеренно. Если картинка не появилась, первым делом
сверь имя со списком выше.

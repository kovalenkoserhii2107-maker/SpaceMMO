# Растровые иллюстрации

Сюда кладутся картинки объектов. Клиент ищет их по имени типа в нижнем регистре:

| Папка | Пример пути | Откуда берется имя |
| --- | --- | --- |
| `buildings/` | `/assets/buildings/ore_mine.webp` | значение `BuildingType` |
| `ships/` | `/assets/ships/heavy_cruiser.webp` | значение `ShipType` |
| `defense/` | `/assets/defense/cannon_turret.webp` | значение `DefenseType` |

Полный список ожидаемых файлов:

**buildings:** `ore_mine`, `polymer_plant`, `plasma_reactor`, `power_plant`,
`science_center`, `shipyard`, `antimatter_factory`, `storage`

**ships:** `probe`, `transporter`, `light_fighter`, `heavy_cruiser`, `ion_frigate`,
`recycler`

**defense:** `cannon_turret`, `laser_turret`

Формат — `.webp`, квадрат (рекомендуется 256×256). Пока файла нет, карточка
показывает стилизованную заглушку: верстка от отсутствия картинки не ломается.

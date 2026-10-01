<?php

declare(strict_types=1);

namespace App\Factory;

use App\Entity\Ticket;
use App\Enum\TicketPriority;
use App\Enum\TicketStatus;
use Zenstruck\Foundry\Object\Instantiator;
use Zenstruck\Foundry\Persistence\PersistentObjectFactory;

/**
 * Creates plausible tickets for fixtures and tests.
 *
 * @extends PersistentObjectFactory<Ticket>
 */
final class TicketFactory extends PersistentObjectFactory
{
    private const SUBJECTS = [
        'Drucker', 'VPN-Zugang', 'Laptop', 'Monitor', 'E-Mail-Postfach', 'WLAN', 'Telefonanlage',
        'Zeiterfassung', 'CRM', 'Backup', 'Firewall', 'Beamer', 'Kaffeemaschine', 'Zutrittskarte',
        'Webshop', 'Rechnungsexport', 'Passwort-Reset', 'Teams-Kanal', 'Dateiserver', 'Lizenz',
    ];
    private const PROBLEMS = [
        'funktioniert nicht', 'ist sehr langsam', 'muss eingerichtet werden', 'zeigt Fehlermeldung',
        'fällt sporadisch aus', 'braucht ein Update', 'für neue Kollegin', 'nach Umzug prüfen',
        'Berechtigung fehlt', 'Zertifikat läuft ab',
    ];
    private const ASSIGNEES = ['anna', 'ben', 'carla', 'deniz', 'emil', 'fatma', 'gregor', 'hanna'];

    public static function class(): string
    {
        return Ticket::class;
    }

    protected function defaults(): array
    {
        $faker = self::faker();
        $createdAt = \DateTimeImmutable::createFromMutable($faker->dateTimeBetween('-90 days', '-1 hour'));

        return [
            'title' => $faker->randomElement(self::SUBJECTS).' '.$faker->randomElement(self::PROBLEMS),
            'description' => $faker->optional(0.8)->realText(300),
            'status' => $faker->randomElement([
                ...array_fill(0, 9, TicketStatus::Open),
                ...array_fill(0, 5, TicketStatus::InProgress),
                ...array_fill(0, 6, TicketStatus::Done),
            ]),
            'priority' => $faker->randomElement([
                ...array_fill(0, 3, TicketPriority::Low),
                ...array_fill(0, 5, TicketPriority::Medium),
                ...array_fill(0, 2, TicketPriority::High),
            ]),
            'assignee' => $faker->optional(0.85)->randomElement(self::ASSIGNEES),
            'dueDate' => $faker->boolean(70)
                ? \DateTimeImmutable::createFromMutable($faker->dateTimeBetween('-30 days', '+60 days'))->setTime(0, 0)
                : null,
            'createdAt' => $createdAt,
            'updatedAt' => \DateTimeImmutable::createFromMutable($faker->dateTimeBetween($createdAt->format(\DATE_ATOM), 'now')),
        ];
    }

    protected function initialize(): static
    {
        // createdAt/updatedAt have no setters (the entity manages them); alwaysForce()
        // lets the factory set them anyway, so the fixtures have a realistic history.
        return $this
            ->instantiateWith(Instantiator::withConstructor()->alwaysForce());
    }
}

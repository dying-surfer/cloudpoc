<?php

declare(strict_types=1);

namespace App\Enum;

enum TicketStatus: string
{
    case Open = 'open';
    case InProgress = 'in_progress';
    case Done = 'done';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(static fn (self $case): string => $case->value, self::cases());
    }
}

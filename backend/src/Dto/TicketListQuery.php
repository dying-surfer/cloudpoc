<?php

declare(strict_types=1);

namespace App\Dto;

use App\Enum\TicketPriority;
use App\Enum\TicketStatus;
use Symfony\Component\Serializer\Attribute\Context;
use Symfony\Component\Serializer\Normalizer\DateTimeNormalizer;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Query parameters of GET /api/tickets. All filters are optional and combined with AND.
 */
final class TicketListQuery
{
    public const SORT_FIELDS = ['title', 'status', 'priority', 'assignee', 'dueDate', 'createdAt', 'updatedAt'];

    public function __construct(
        /** Full-text-ish search in title and description (case-insensitive substring). */
        #[Assert\Length(max: 200)]
        public ?string $q = null,
        public ?TicketStatus $status = null,
        public ?TicketPriority $priority = null,
        /** Exact match. */
        #[Assert\Length(max: 100)]
        public ?string $assignee = null,
        /** Tickets due strictly before this date (YYYY-MM-DD). */
        #[Context([DateTimeNormalizer::FORMAT_KEY => '!Y-m-d'])]
        public ?\DateTimeImmutable $dueBefore = null,
        /** Field name, prefix "-" for descending, e.g. "-dueDate". */
        #[Assert\Choice(callback: [self::class, 'sortChoices'], message: 'Allowed values: title, status, priority, assignee, dueDate, createdAt, updatedAt (prefix "-" for descending).')]
        public string $sort = '-createdAt',
        #[Assert\Positive]
        public int $page = 1,
        #[Assert\Range(min: 1, max: 100)]
        public int $pageSize = 20,
    ) {
    }

    /**
     * @return list<string>
     */
    public static function sortChoices(): array
    {
        return [...self::SORT_FIELDS, ...array_map(static fn (string $f): string => '-'.$f, self::SORT_FIELDS)];
    }
}

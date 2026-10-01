<?php

declare(strict_types=1);

namespace App\Dto;

use App\Enum\TicketPriority;
use App\Enum\TicketStatus;
use OpenApi\Attributes as OA;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * Query parameters of GET /api/tickets. All filters are optional and combined with AND.
 * Like TicketInput, enum and date parameters are strings validated by constraints.
 */
final class TicketListQuery
{
    public const SORT_FIELDS = ['title', 'status', 'priority', 'assignee', 'dueDate', 'createdAt', 'updatedAt'];

    /** Case-insensitive substring search in title and description. */
    #[Assert\Length(max: 200)]
    public ?string $q = null;

    #[Assert\Choice(callback: [TicketStatus::class, 'values'], message: 'Allowed values: {{ choices }}.')]
    public ?string $status = null;

    #[Assert\Choice(callback: [TicketPriority::class, 'values'], message: 'Allowed values: {{ choices }}.')]
    public ?string $priority = null;

    /** Exact match. */
    #[Assert\Length(max: 100)]
    public ?string $assignee = null;

    /** Tickets due strictly before this date. */
    #[Assert\Date(message: 'Expected a valid date in the format YYYY-MM-DD.')]
    #[OA\Property(format: 'date')]
    public ?string $dueBefore = null;

    /** Field name, prefix "-" for descending, e.g. "-dueDate". */
    #[Assert\Choice(callback: [self::class, 'sortChoices'], message: 'Allowed values: title, status, priority, assignee, dueDate, createdAt, updatedAt (prefix "-" for descending).')]
    public string $sort = '-createdAt';

    #[Assert\Positive]
    public int $page = 1;

    #[Assert\Range(min: 1, max: 100)]
    public int $pageSize = 20;

    /**
     * @return list<string>
     */
    public static function sortChoices(): array
    {
        return [...self::SORT_FIELDS, ...array_map(static fn (string $f): string => '-'.$f, self::SORT_FIELDS)];
    }

    public function statusEnum(): ?TicketStatus
    {
        return null === $this->status ? null : TicketStatus::from($this->status);
    }

    public function priorityEnum(): ?TicketPriority
    {
        return null === $this->priority ? null : TicketPriority::from($this->priority);
    }

    public function dueBeforeObject(): ?\DateTimeImmutable
    {
        return null === $this->dueBefore ? null : new \DateTimeImmutable($this->dueBefore);
    }
}

<?php

declare(strict_types=1);

namespace App\Dto;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * Request body of PUT /api/tickets/{id}: replaces the whole ticket (omitted fields
 * are reset to their defaults) and must carry the version the client last read.
 */
final class TicketUpdateInput extends TicketInput
{
    /** The version you last read; a newer version on the server means 409 Conflict. */
    #[Assert\NotNull]
    public ?int $version = null;
}

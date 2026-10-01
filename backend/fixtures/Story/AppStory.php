<?php

declare(strict_types=1);

namespace App\Fixtures\Story;

use App\Fixtures\Factory\TicketFactory;
use Zenstruck\Foundry\Story;

/**
 * Demo data for development and staging: `bin/console doctrine:fixtures:load`.
 */
final class AppStory extends Story
{
    public function build(): void
    {
        TicketFactory::createMany(200);
    }
}

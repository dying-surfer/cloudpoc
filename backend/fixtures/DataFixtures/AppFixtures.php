<?php

declare(strict_types=1);

namespace App\Fixtures\DataFixtures;

use App\Fixtures\Story\AppStory;
use Doctrine\Bundle\FixturesBundle\Fixture;
use Doctrine\Persistence\ObjectManager;

class AppFixtures extends Fixture
{
    public function load(ObjectManager $manager): void
    {
        AppStory::load();
    }
}

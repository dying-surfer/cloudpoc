<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261001123258 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Create ticket table';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE ticket (id UUID NOT NULL, title VARCHAR(200) NOT NULL, description TEXT DEFAULT NULL, status VARCHAR(20) NOT NULL, priority VARCHAR(20) NOT NULL, assignee VARCHAR(100) DEFAULT NULL, due_date DATE DEFAULT NULL, created_at TIMESTAMP(0) WITH TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITH TIME ZONE NOT NULL, version INT DEFAULT 1 NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE INDEX idx_ticket_status ON ticket (status)');
        $this->addSql('CREATE INDEX idx_ticket_priority ON ticket (priority)');
        $this->addSql('CREATE INDEX idx_ticket_assignee ON ticket (assignee)');
        $this->addSql('CREATE INDEX idx_ticket_due_date ON ticket (due_date)');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE ticket');
    }
}

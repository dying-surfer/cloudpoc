<?php

declare(strict_types=1);

namespace App\Tests\Api;

final class HealthTest extends ApiTestCase
{
    public function testLiveness(): void
    {
        self::assertSame(['status' => 'ok'], $this->request('GET', '/healthz'));
        self::assertResponseIsSuccessful();
    }

    public function testReadinessChecksDatabase(): void
    {
        self::assertSame(['status' => 'ok', 'checks' => ['database' => 'ok']], $this->request('GET', '/readyz'));
        self::assertResponseIsSuccessful();
    }

    public function testOpenApiDocumentListsTicketEndpoints(): void
    {
        $doc = $this->request('GET', '/api/doc.json');

        self::assertResponseIsSuccessful();
        self::assertIsArray($doc['paths'] ?? null);
        self::assertArrayHasKey('/api/tickets', $doc['paths']);
        self::assertArrayHasKey('/api/tickets/{id}/close', $doc['paths']);
    }

    public function testUnknownApiRouteIsProblemDetails(): void
    {
        $this->assertProblem(404, $this->request('GET', '/api/does-not-exist'));
    }
}

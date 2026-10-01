<?php

declare(strict_types=1);

namespace App\Tests\Api;

use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Zenstruck\Foundry\Test\Factories;
use Zenstruck\Foundry\Test\ResetDatabase;

/**
 * Base class for HTTP-level tests against the real Postgres test database.
 *
 * ResetDatabase creates the test DB once per run (via migrations, see
 * zenstruck_foundry.yaml); DAMA wraps every test in a transaction that is
 * rolled back afterwards, so tests are isolated and fast.
 */
abstract class ApiTestCase extends WebTestCase
{
    use Factories;
    use ResetDatabase;

    protected KernelBrowser $client;

    protected function setUp(): void
    {
        $this->client = static::createClient();
    }

    /**
     * Sends a request and returns the decoded JSON body (empty array for no body).
     *
     * @param array<string, mixed>|null $json
     *
     * @return array<string, mixed>
     */
    protected function request(string $method, string $uri, ?array $json = null): array
    {
        $this->client->request(
            $method,
            $uri,
            server: null === $json ? [] : ['CONTENT_TYPE' => 'application/json'],
            content: null === $json ? null : json_encode($json, \JSON_THROW_ON_ERROR),
        );

        $content = (string) $this->client->getResponse()->getContent();
        if ('' === $content) {
            return [];
        }

        $data = json_decode($content, true, flags: \JSON_THROW_ON_ERROR);
        self::assertIsArray($data);

        /* @var array<string, mixed> $data */
        return $data;
    }

    /**
     * @param array<string, mixed> $body
     */
    protected function assertProblem(int $status, array $body): void
    {
        self::assertResponseStatusCodeSame($status);
        self::assertResponseHeaderSame('Content-Type', 'application/problem+json');
        self::assertSame('about:blank', $body['type'] ?? null);
        self::assertSame($status, $body['status'] ?? null);
        self::assertArrayHasKey('title', $body);
    }

    /**
     * @param array<string, mixed> $body
     *
     * @return list<string> the fields that have violations
     */
    protected function violationFields(array $body): array
    {
        self::assertIsArray($body['violations'] ?? null);

        return array_values(array_map(
            static fn (mixed $v): string => \is_array($v) && \is_string($v['field'] ?? null) ? $v['field'] : '',
            $body['violations'],
        ));
    }
}

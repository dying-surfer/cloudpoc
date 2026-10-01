<?php

declare(strict_types=1);

namespace App\Serializer;

use Symfony\Component\Serializer\Exception\NotNormalizableValueException;
use Symfony\Component\Serializer\Normalizer\DenormalizerInterface;

/**
 * Like Symfony's BackedEnumNormalizer, but an invalid value produces an error message
 * meant for API clients ("Allowed values: open, in_progress, done") instead of one
 * that names the PHP enum class. Autoconfigured with priority 0, so it runs before
 * the built-in normalizer.
 */
final class EnumDenormalizer implements DenormalizerInterface
{
    public function denormalize(mixed $data, string $type, ?string $format = null, array $context = []): \BackedEnum
    {
        /** @var class-string<\BackedEnum> $type */
        $enum = \is_int($data) || \is_string($data) ? $type::tryFrom($data) : null;

        if (null === $enum) {
            $allowed = implode(', ', array_map(static fn (\BackedEnum $case): string => (string) $case->value, $type::cases()));

            throw NotNormalizableValueException::createForUnexpectedDataType(\sprintf('Allowed values: %s.', $allowed), $data, ['string'], $context['deserialization_path'] ?? null, true);
        }

        return $enum;
    }

    public function supportsDenormalization(mixed $data, string $type, ?string $format = null, array $context = []): bool
    {
        return is_subclass_of($type, \BackedEnum::class);
    }

    public function getSupportedTypes(?string $format): array
    {
        return [\BackedEnum::class => true];
    }
}

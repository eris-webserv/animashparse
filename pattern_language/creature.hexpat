// Animash — SavedAnimals/creature_N.bytes
//
// [u16]  string_count  (= 2 × number of stat key-value pairs)
// [string_count × Utf16String]  alternating key, value
//   [u16]  byte_len  (byte length of UTF-16LE payload)
//   [char16 × byte_len/2]  UTF-16LE characters
// [s32]  image_byte_count
// [u8 × image_byte_count]  raw PNG/JPEG image

#pragma endian little
#pragma pattern_limit 1048576
#pragma array_limit  1048576

struct Utf16String {
    u16    byte_len;
    char16 chars[byte_len / 2];
};

struct StatPair {
    Utf16String key;
    Utf16String value;
};

struct CreatureFile {
    u16      string_count;
    StatPair stats[string_count / 2];
    s32      image_byte_count;
    u8       image[image_byte_count];
};

CreatureFile file @ 0x00;

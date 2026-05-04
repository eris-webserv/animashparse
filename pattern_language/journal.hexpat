// Animash — Journal/<animalA> + <animalB>.bytes
//
// [u8]             skip_count  (stored length of the random padding, range 3–14)
// [u8 × skip_count]  padding   (random garbage bytes, meaningless)
// [u8 × remainder]   image     (raw PNG)

#pragma endian little

struct JournalFile {
    u8 skip_count;
    u8 padding[skip_count];
    u8 image[std::mem::size() - 1 - skip_count];
};

JournalFile file @ 0x00;

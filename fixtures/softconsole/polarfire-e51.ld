/*
 * Representative, hand-trimmed excerpt of a Microchip SoftConsole
 * bare-metal linker script for a PolarFire SoC E51 (RISC-V) monitor core,
 * reconstructed from well-known SoftConsole HAL conventions (envm/e51_dtim
 * region names, . = ALIGN() bookended sections, AT> load-address splitting
 * for the initialized data section). Swap in a real SoftConsole-generated
 * script if available.
 */
OUTPUT_ARCH("riscv")
ENTRY(_start)

MEMORY
{
    envm       (rx)  : ORIGIN = 0x20220000, LENGTH = 0x00200000
    e51_dtim   (rwx) : ORIGIN = 0x01000000, LENGTH = 0x00002000
    ddr_cached (rwx) : ORIGIN = 0x80000000, LENGTH = 0x40000000
}

SECTIONS
{
    .text :
    {
        . = ALIGN(0x4);
        _stext = .;
        *(.text.init)
        *(.text .text.* .gnu.linkonce.t.*)
        *(.plt)
        . = ALIGN(0x4);
        _etext = .;
    } > envm

    .rodata :
    {
        . = ALIGN(0x4);
        _srodata = .;
        *(.rodata .rodata.*)
        . = ALIGN(0x4);
        _erodata = .;
    } > envm

    .data :
    {
        . = ALIGN(0x4);
        _sdata = .;
        *(.data .data.*)
        . = ALIGN(0x4);
        _edata = .;
    } > ddr_cached AT> envm

    .bss (NOLOAD) :
    {
        . = ALIGN(0x4);
        _sbss = .;
        *(.sbss .sbss.* .bss .bss.*)
        . = ALIGN(0x4);
        _ebss = .;
    } > ddr_cached

    .stack (NOLOAD) :
    {
        . = ALIGN(0x10);
        _sstack = .;
        . += 0x2000;
        _estack = .;
    } > e51_dtim
}

/*
 * This is a representative, hand-trimmed excerpt of a Xilinx Vitis/SDK
 * BSP-generated lscript.ld for a Zynq UltraScale+ MPSoC (Cortex-A53) APU
 * standalone application, reconstructed from well-known BSP conventions.
 * It is NOT a literal vendor file -- swap in a real one if available, the
 * same way the softconsole fixture should be swapped for a real SoftConsole
 * output. Kept here so the parser/serializer are exercised against
 * realistic, sometimes-quirky structure (bare DEFINED()?: assignments,
 * (NOLOAD) section types, KEEP(), multiple heap/stack regions) rather than
 * only a clean hand-written toy example.
 */
_STACK_SIZE = DEFINED(_STACK_SIZE) ? _STACK_SIZE : 0x2000;
_HEAP_SIZE = DEFINED(_HEAP_SIZE) ? _HEAP_SIZE : 0x100000;

OUTPUT_ARCH(aarch64)
ENTRY(_start)

MEMORY
{
   psu_ocm_ram_0_MEM0 : ORIGIN = 0xFFFC0000, LENGTH = 0x40000
   psu_ddr_0_MEM0 : ORIGIN = 0x00100000, LENGTH = 0x3FF00000
}

SECTIONS
{
.text : {
   KEEP (*(.vectors))
   *(.boot)
   *(.text)
   *(.text.*)
   *(.gnu.linkonce.t.*)
   *(.plt)
   *(.gnu_warning)
   *(.gcc_except_table)
   *(.glue_7)
   *(.glue_7t)
   *(.vfp11_veneer)
   *(.ARM.extab)
   *(.gnu.linkonce.armextab.*)
} > psu_ddr_0_MEM0

.init : {
   KEEP (*(.init))
} > psu_ddr_0_MEM0

.fini : {
   KEEP (*(.fini))
} > psu_ddr_0_MEM0

.rodata : {
   __rodata_start = .;
   *(.rodata)
   *(.rodata.*)
   *(.gnu.linkonce.r.*)
   __rodata_end = .;
} > psu_ddr_0_MEM0

.data : {
   __data_start = .;
   *(.data)
   *(.data.*)
   *(.gnu.linkonce.d.*)
   __data_end = .;
} > psu_ddr_0_MEM0

.bss (NOLOAD) : {
   . = ALIGN(4);
   __bss_start__ = .;
   *(.bss)
   *(.bss.*)
   *(COMMON)
   . = ALIGN(4);
   __bss_end__ = .;
} > psu_ddr_0_MEM0

.heap (NOLOAD) : {
   . = ALIGN(16);
   _heap = .;
   HeapBase = .;
   _heap_start = .;
   . += _HEAP_SIZE;
   _heap_end = .;
   HeapLimit = .;
} > psu_ddr_0_MEM0

.stack (NOLOAD) : {
   . = ALIGN(16);
   _stack_end = .;
   . += _STACK_SIZE;
   . = ALIGN(16);
   _stack = .;
   __stack = _stack;
   _stack_start = .;
} > psu_ocm_ram_0_MEM0

_end = .;
PROVIDE(end = .);
}
